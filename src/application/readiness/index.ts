// Judges a resolved target: coverage and access first, then the tool's own
// state, then the setup steps that are still pending. A resolved target that is
// not ready is a verdict with recovery guidance, never an error. Results are
// remembered per tool, because one command judges many targets.

import { DevkitError, handoffEnvelope } from '../../domain/errors.js';
import { platformOf, type Binding, type PlatformBinding } from '../../domain/manifest/providers.js';
import { undeclaredPlatform } from '../../domain/obs/coordinate.js';
import { problemsOfTool } from '../../domain/setup/names.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import { environmentsOf, envNotFound } from '../env/names.js';
import { buildPlan } from '../login/collect.js';
import type { LoginDeps } from '../login/deps.js';
import { handoffStep, loginCommand } from '../login/handoff.js';
import { gaveNoAnswer, Verifier } from '../login/verify.js';
import { isTrustRequired } from '../safety/trust.js';
import { ToolCheck, toolRecoveryCommand } from '../tool/check.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

import { resolveTarget, targetOfBinding } from './resolve.js';
import type {
  PendingStep,
  PendingSteps,
  ReadyStatus,
  Target,
  ToolReadiness,
  UnfinishedCheck,
  Verdict,
} from './types.js';
import { untrusted, versionUnknown } from './verdicts.js';

export class Readiness {
  private readonly toolStates = new Map<string, Promise<ToolReadiness>>();
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

  targetOf(binding: Binding | PlatformBinding): Target | null {
    return targetOfBinding(this.deps, this.login, binding);
  }

  async judge(target: Target, env: string | null): Promise<Verdict> {
    const coverage = this.coverage(target, env);
    if (coverage !== undefined)
      return this.verdict('not_covered', {
        alternatives: [coverage, this.command('doctor')],
      });
    if (env !== null && !this.inScope(env))
      return this.verdict('no_access', {
        alternatives: [this.command('env', 'pick', env), this.command('doctor')],
      });

    if (target.tool === null) return this.verdict('ready');

    const state = await this.toolState(target.tool);
    if (state === 'untrusted') return untrusted(this.deps, this.login, target.tool.name);
    if (state === 'unknown') return versionUnknown(this.deps, target.tool);
    if (state !== 'ok')
      return this.verdict(
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
              toolRecoveryCommand(state),
              target.tool.name,
            ),
          }),
        },
      );

    const setupEnv = target.binding !== null && platformOf(target.binding) !== null ? env : null;
    return this.setupVerdict(target.tool.name, setupEnv);
  }

  private verdict(status: ReadyStatus, extra: Partial<Verdict> = {}): Verdict {
    return { status, handoff: null, alternatives: [this.command('doctor')], ...extra };
  }

  // A step whose check failed is handed over, and outranks a check that could not finish:
  // nobody is handed a sign-in for the latter, checking again is its only step.
  private async setupVerdict(tool: string, env: string | null): Promise<Verdict> {
    const pending = await this.pendingSteps(tool, env);
    if (pending === 'untrusted') return untrusted(this.deps, this.login, tool);
    if ('problems' in pending)
      return this.verdict('unconfigured', {
        handoff: handoffEnvelope({
          summary: `Setup cannot be verified: ${pending.problems.join('; ')}`,
          userSteps: [],
          command: this.command('manifest', 'providers'),
          alternatives: [this.command('manifest', 'validate', '--strict')],
        }),
      });
    const { steps, unfinished } = pending;
    const unknown = unfinished.length === 0 ? {} : { unfinished };
    if (steps.length > 0)
      return this.verdict('unconfigured', {
        ...unknown,
        handoff: handoffEnvelope({
          summary: `${steps.length} setup step${steps.length === 1 ? '' : 's'} not done for ${tool}`,
          userSteps: steps.map((item) => handoffStep(item.step, item.pending)),
          command: loginCommand(
            steps.map((item) => item.step),
            this.deps,
          ),
        }),
      });
    if (unfinished.length === 0) return this.verdict('ready');
    return this.verdict('unknown', {
      ...unknown,
      handoff: handoffEnvelope({
        summary: `Could not finish checking ${unfinished.map((check) => check.id).join(', ')}`,
        userSteps: [],
        command: this.command('doctor', '--tool', tool, ...(env === null ? [] : ['--env', env])),
      }),
    });
  }

  // Why the environment does not cover the target, when it does not.
  private coverage(target: Target, env: string | null): string | undefined {
    const platform = target.binding === null ? null : platformOf(target.binding);
    if (env === null || platform === null) return undefined;
    const environments = environmentsOf(this.deps.ctx, this.deps.commandShell);
    const spec = environments.envs[env];
    if (spec === undefined) throw envNotFound(this.deps, env, Object.keys(environments.envs));
    return spec.platforms?.[platform] === undefined ? undeclaredPlatform(env, platform) : undefined;
  }

  private inScope(env: string): boolean {
    const scope = this.deps.ctx.local.scope?.envs;
    return scope === undefined || scope.includes(env);
  }

  private async toolState(tool: ResolvedTool): Promise<ToolReadiness> {
    const cached = this.toolStates.get(tool.name);
    if (cached !== undefined) return cached;
    const state = this.inspectToolState(tool);
    this.toolStates.set(tool.name, state);
    return state;
  }

  private async inspectToolState(tool: ResolvedTool): Promise<ToolReadiness> {
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
    const problems = problemsOfTool(plan.problems, tool);
    if (problems.length > 0) return { problems: problems.map((p) => p.detail) };
    const verifier = new Verifier(this.deps, this.login);
    const steps: PendingStep[] = [];
    const unfinished: UnfinishedCheck[] = [];
    // A step waiting on an unfinished check is as unknown as that check is, whatever
    // else it waits on.
    const undone = new Set<string>();
    const unknown = new Set<string>();
    for (const step of plan.steps) {
      if (step.requires.some((id) => unknown.has(id))) {
        unknown.add(step.id);
        continue;
      }
      const blockedBy = step.requires.find((id) => undone.has(id));
      if (blockedBy !== undefined) {
        steps.push({ step, pending: { blockedBy } });
        undone.add(step.id);
        continue;
      }
      try {
        const failed = await verifier.verify(step);
        if (failed.ok) continue;
        steps.push({ step, pending: { failed } });
        undone.add(step.id);
      } catch (err) {
        if (isTrustRequired(err)) return 'untrusted';
        if (!(err instanceof DevkitError) || !gaveNoAnswer(err.code)) throw err;
        unfinished.push({ id: step.id, code: err.code, message: err.message });
        unknown.add(step.id);
      }
    }
    return { steps, unfinished };
  }
}
