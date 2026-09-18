// Resolves an unambiguous capability or tool target, then evaluates coverage, access,
// installation and configuration. Invalid or ambiguous targets are usage/configuration
// errors; a resolved target that is not ready is a verdict with recovery guidance.

import {
  CAPABILITIES,
  CAPABILITY_INFO,
  knownCapability,
  type Capability,
} from '../domain/capability.js';
import { DevkitError, handoffEnvelope, type HandoffEnvelope } from '../domain/errors.js';
import { nearest } from '../domain/fuzzy.js';
import type { Binding, PlatformBinding } from '../domain/manifest/providers.js';
import type { SetupStep } from '../domain/setup/types.js';
import { shellLine } from '../domain/shell.js';
import type { ResolvedTool } from '../domain/toolchain/resolve.js';

import { environmentsOf, envNotFound } from './env/names.js';
import { buildPlan } from './login/collect.js';
import type { LoginDeps } from './login/deps.js';
import { handoffStep, loginCommand } from './login/handoff.js';
import { Verifier } from './login/verify.js';
import { commandTrustHandoff, isTrustRequired } from './safety/trust.js';
import { ToolCheck } from './tool/check.js';
import { toolchainOf } from './tool/toolchain.js';
import type { WorkspaceDeps } from './workspace/deps.js';
import { workspaceCommand } from './workspace/guidance.js';

export type ReadyStatus =
  | 'ready'
  | 'missing_tool'
  | 'outdated_tool'
  | 'disabled_tool'
  | 'unconfigured'
  | 'no_access'
  | 'not_covered'
  | 'unknown';

export interface Target {
  readonly capability: Capability | null;
  readonly tool: ResolvedTool | null;
  readonly binding: Binding | PlatformBinding | null;
}

export interface Verdict {
  readonly status: ReadyStatus;
  readonly handoff: HandoffEnvelope | null;
  readonly alternatives: readonly string[];
}

type PendingSteps = SetupStep[] | 'untrusted' | { readonly problems: readonly string[] };

export class Readiness {
  private readonly toolStates = new Map<
    string,
    Promise<'ok' | 'missing' | 'outdated' | 'disabled' | 'unknown' | 'untrusted'>
  >();
  private readonly pending = new Map<string, Promise<PendingSteps>>();

  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
  ) {}

  private command(...args: readonly string[]): string {
    return workspaceCommand(this.deps, ...args);
  }

  resolve(name: string, env: string | undefined): Target {
    const tools = toolchainOf(this.deps.ctx).tools;
    const named = knownCapability(name);
    if (named !== null) {
      const capability = named;
      const binding = this.bindingFor(capability, env);
      const tool = binding === null ? undefined : this.toolOf(binding);
      if (binding === null || tool === undefined) {
        throw new DevkitError(
          'config',
          'CAPABILITY_UNBOUND',
          `No provider serves ${capability}${env === undefined ? '' : ` in ${env}`}`,
          {
            hint: CAPABILITY_INFO[capability].desc,
            nextSteps: [this.command('manifest', 'providers')],
          },
        );
      }
      return { capability, tool, binding };
    }
    const tool = tools.find((t) => t.name === name);
    if (tool !== undefined)
      return { capability: null, tool, binding: this.bindingDriving(tool.name, env) };
    const suggestion = nearest(name, [...CAPABILITIES, ...tools.map((t) => t.name)]);
    throw new DevkitError(
      'not_found',
      'CAN_UNKNOWN',
      `"${name}" is neither a capability nor a tool`,
      {
        hint:
          suggestion === undefined
            ? `Capabilities: ${CAPABILITIES.join(', ')}.`
            : `Did you mean "${suggestion}"?`,
        nextSteps: [this.command('manifest', 'providers'), this.command('tool', 'list')],
      },
    );
  }

  targetOf(binding: PlatformBinding): Target | null {
    const tool = this.toolOf(binding);
    if (tool === undefined) return null;
    return { capability: knownCapability(binding.capability), tool, binding };
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
    if (state === 'untrusted') return this.untrusted(target.tool.name);
    if (state === 'unknown') return this.versionUnknown(target.tool);
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
    if (pending === 'untrusted') return this.untrusted(target.tool.name);
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

  // A family provider is named after its tool; the descriptor may say otherwise.
  private toolOf(binding: Binding | PlatformBinding): ResolvedTool | null | undefined {
    if (binding.provider === null) return undefined;
    const descriptor = this.login.describeProvider(binding.provider);
    if (descriptor?.capability === binding.capability && descriptor.tools.length === 0) return null;
    const name = descriptor?.tools[0] ?? binding.provider;
    return toolchainOf(this.deps.ctx).tools.find((t) => t.name === name);
  }

  // An environment-scoped capability lives on a platform instance; which
  // one is the environment's business, so it needs --env.
  private bindingFor(
    capability: Capability,
    env: string | undefined,
  ): Binding | PlatformBinding | null {
    if (CAPABILITY_INFO[capability].scope !== 'environment')
      return this.deps.ctx.bindings.find((b) => b.capability === capability) ?? null;
    if (env === undefined) {
      throw new DevkitError(
        'usage',
        'ENV_REQUIRED',
        `${capability} depends on the environment; pass --env`,
        {
          hint: 'Environments are listed by `fx env list`.',
          nextSteps: [
            this.command('env', 'list'),
            this.command('can', capability, '--env', '<env>'),
          ],
        },
      );
    }
    return this.selectBinding(
      this.deps.ctx.platforms.filter((b) => b.capability === capability),
      env,
      capability,
    );
  }

  private bindingDriving(tool: string, env: string | undefined): Binding | PlatformBinding | null {
    const drives = (b: Binding | PlatformBinding): boolean =>
      b.provider !== null && (this.login.describeProvider(b.provider)?.tools ?? []).includes(tool);
    return this.selectBinding(
      [...this.deps.ctx.bindings, ...this.deps.ctx.platforms].filter(drives),
      env,
      tool,
    );
  }

  private selectBinding(
    candidates: readonly (Binding | PlatformBinding)[],
    env: string | undefined,
    name: string,
  ): Binding | PlatformBinding | null {
    let scoped = candidates;
    if (env !== undefined && candidates.some((binding) => 'platform' in binding)) {
      const environments = environmentsOf(this.deps.ctx, this.deps.commandShell);
      const spec = environments.envs[env];
      if (spec === undefined) throw envNotFound(this.deps, env, Object.keys(environments.envs));
      const covered = candidates.filter(
        (b) => !('platform' in b) || spec.platforms?.[b.platform] !== undefined,
      );
      // Retain a single uncovered binding so coverage remains a negative verdict.
      if (covered.length > 0) scoped = covered;
    }
    if (scoped.length > 1) {
      const names = scoped.map((b) => ('platform' in b ? b.platform : b.capability)).sort();
      throw new DevkitError(
        'usage',
        'CAN_AMBIGUOUS',
        `${name} matches multiple bindings: ${names.join(', ')}`,
        {
          hint: 'Choose a capability and environment with one binding; use where --platform to inspect a specific platform.',
          nextSteps: [
            this.command('manifest', 'providers'),
            this.command('env', 'list'),
            'fx where --help',
          ],
        },
      );
    }
    return scoped[0] ?? null;
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

  private async toolState(
    tool: ResolvedTool,
  ): Promise<'ok' | 'missing' | 'outdated' | 'disabled' | 'unknown' | 'untrusted'> {
    const cached = this.toolStates.get(tool.name);
    if (cached !== undefined) return cached;
    const state = this.inspectToolState(tool);
    this.toolStates.set(tool.name, state);
    return state;
  }

  private async inspectToolState(
    tool: ResolvedTool,
  ): Promise<'ok' | 'missing' | 'outdated' | 'disabled' | 'unknown' | 'untrusted'> {
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

  private versionUnknown(tool: ResolvedTool): Verdict {
    const command = this.command('doctor', '--tool', tool.name);
    const inspect = this.command('tool', 'show', tool.name);
    const probe = shellLine([tool.binary, ...tool.versionArgs], this.deps.commandShell);
    return {
      status: 'unknown',
      handoff: handoffEnvelope({
        summary: `${tool.name} could not pass its version check`,
        command,
        userSteps: [
          {
            id: `${tool.name}.version`,
            kind: 'manual',
            title: 'Diagnose the installed tool before changing authentication',
            instructions: `Inspect the executable on PATH and the result of ${probe}. Check startup errors, exit status and version output; this is not evidence of an authentication failure.`,
          },
        ],
      }),
      alternatives: [inspect, this.command('doctor')],
    };
  }

  private untrusted(tool: string): Verdict {
    const handoff = commandTrustHandoff({
      tool,
      posture: this.login.trust.posture,
      workspace: this.deps.ctx.name,
      commandShell: this.deps.commandShell,
    });
    return {
      status: 'unknown',
      handoff,
      alternatives: handoff.alternatives ?? [this.command('doctor')],
    };
  }
}
