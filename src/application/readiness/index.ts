// Judges a resolved target: coverage and access first, then the tool's own
// state, then the setup steps that are still pending. A resolved target that is
// not ready is a verdict with recovery guidance, never an error. Results are
// remembered per tool, because one command judges many targets.

import { DevkitError, handoffEnvelope } from '../../domain/errors.js';
import type { PlatformBinding } from '../../domain/manifest/providers.js';
import type { SetupStep } from '../../domain/setup/types.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import { environmentsOf, envNotFound } from '../env/names.js';
import { buildPlan } from '../login/collect.js';
import type { LoginDeps } from '../login/deps.js';
import { handoffStep, loginCommand } from '../login/handoff.js';
import { Verifier } from '../login/verify.js';
import { isTrustRequired } from '../safety/trust.js';
import { ToolCheck } from '../tool/check.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

import { resolveTarget, targetOfBinding } from './resolve.js';
import type { PendingSteps, ReadyStatus, Target, ToolState, Verdict } from './types.js';
import { untrusted, versionUnknown } from './verdicts.js';

export class Readiness {
  private readonly toolStates = new Map<string, Promise<ToolState>>();
  private readonly pending = new Map<string, Promise<PendingSteps>>();

  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
  ) {}

  private command(...args: readonly string[]): string {
    return workspaceCommand(this.deps, ...args);
  }

  resolve(name: string, env: string | undefined): Target {
    return resolveTarget(this.deps, this.login, name, env);
  }

  targetOf(binding: PlatformBinding): Target | null {
    return targetOfBinding(this.deps, this.login, binding);
  }

  async judge(target: Target, env: string | null): Promise<Verdict> {
    const verdict = (status: ReadyStatus, extra: Partial<Verdict> = {}): Verdict => ({
      status,
      handoff: null,
      alternatives: [this.command('doctor')],
      ...extra,
    });
    const coverage = this.coverage(target, env);
    if (coverage !== undefined)
      return verdict('not_covered', {
        alternatives: [coverage, this.command('doctor')],
      });
    if (env !== null && !this.inScope(env))
      return verdict('no_access', {
        alternatives: [this.command('env', 'pick', env), this.command('doctor')],
      });

    if (target.tool === null) return verdict('ready');

    const state = await this.toolState(target.tool);
    if (state === 'untrusted') return untrusted(this.deps, this.login, target.tool.name);
    if (state === 'unknown') return versionUnknown(this.deps, target.tool);
    if (state !== 'ok')
      return verdict(
        (
          { outdated: 'outdated_tool', disabled: 'disabled_tool', missing: 'missing_tool' } as const
        )[state],
        {
          handoff: handoffEnvelope({
            summary: `${target.tool.name} is ${state}`,
            userSteps: [],
            command: workspaceCommand(
              this.deps,
              'tool',
              { disabled: 'show', outdated: 'update', missing: 'install' }[state],
              target.tool.name,
            ),
          }),
        },
      );

    const setupEnv = target.binding !== null && 'platform' in target.binding ? env : null;
    const pending = await this.pendingSteps(target.tool.name, setupEnv);
    if (pending === 'untrusted') return untrusted(this.deps, this.login, target.tool.name);
    if ('problems' in pending)
      return verdict('unconfigured', {
        handoff: handoffEnvelope({
          summary: `Setup cannot be verified: ${pending.problems.join('; ')}`,
          userSteps: [],
          command: this.command('manifest', 'providers'),
          alternatives: [this.command('manifest', 'validate', '--strict')],
        }),
      });
    if (pending.length > 0)
      return verdict('unconfigured', {
        handoff: handoffEnvelope({
          summary: `${pending.length} setup step${pending.length === 1 ? '' : 's'} not done for ${target.tool.name}`,
          userSteps: pending.map(handoffStep),
          command: loginCommand(pending, this.deps),
        }),
      });
    return verdict('ready');
  }

  private coverage(target: Target, env: string | null): string | undefined {
    if (env === null || target.binding === null || !('platform' in target.binding))
      return undefined;
    const environments = environmentsOf(this.deps.ctx, this.deps.commandShell);
    const spec = environments.envs[env];
    if (spec === undefined) throw envNotFound(this.deps, env, Object.keys(environments.envs));
    if (spec.platforms?.[target.binding.platform] !== undefined) return undefined;
    return spec.note ?? `${env} has no ${target.binding.platform}`;
  }

  private inScope(env: string): boolean {
    const scope = this.deps.ctx.local.scope?.envs;
    return scope === undefined || scope.includes(env);
  }

  private async toolState(tool: ResolvedTool): Promise<ToolState> {
    const cached = this.toolStates.get(tool.name);
    if (cached !== undefined) return cached;
    const state = this.inspectToolState(tool);
    this.toolStates.set(tool.name, state);
    return state;
  }

  private async inspectToolState(tool: ResolvedTool): Promise<ToolState> {
    try {
      const [status] = await new ToolCheck({
        run: this.deps.processRun,
        which: this.deps.processWhich,
      }).execute({
        tools: [tool],
        trust: {
          gate: this.login.trust.gate,
          workspace: this.deps.ctx.name,
          commandShell: this.deps.commandShell,
          yes: this.login.trust.yes,
          posture: this.login.trust.posture,
        },
      });
      if (status === undefined) return 'unknown';
      return status.state;
    } catch (err) {
      if (isTrustRequired(err)) return 'untrusted';
      if (err instanceof DevkitError) return 'unknown';
      throw err;
    }
  }

  private async pendingSteps(tool: string, env: string | null): Promise<PendingSteps> {
    const key = `${tool}\0${env ?? ''}`;
    const cached = this.pending.get(key);
    if (cached !== undefined) return cached;
    const steps = this.inspectPendingSteps(tool, env);
    this.pending.set(key, steps);
    return steps;
  }

  private async inspectPendingSteps(tool: string, env: string | null): Promise<PendingSteps> {
    const plan = buildPlan(this.deps, this.login, {
      tools: [tool],
      envs: env === null ? undefined : [env],
      scopeEnvs: this.deps.ctx.local.scope?.envs,
    });
    const problems = plan.problems.filter((p) => p.step.startsWith(`${tool}.`));
    if (problems.length > 0) return { problems: problems.map((p) => p.detail) };
    const verifier = new Verifier(this.deps, this.login);
    const pending: SetupStep[] = [];
    for (const step of plan.steps) {
      try {
        if (step.requires.some((id) => pending.some((item) => item.id === id))) {
          pending.push(step);
          continue;
        }
        if (!(await verifier.verify(step)).ok) pending.push(step);
      } catch (err) {
        if (isTrustRequired(err)) return 'untrusted';
        throw err;
      }
    }
    return pending;
  }
}
