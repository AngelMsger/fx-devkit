// Resolve repository coordinates and readiness using read-only provider queries.
// Recording probe evidence is a separate, explicit write operation.

import {
  asDevkitError,
  categoryOfExitCode,
  DevkitError,
  type HandoffEnvelope,
} from '../../domain/errors.js';
import { nearest, suggestionHint } from '../../domain/fuzzy.js';
import type { Confidence } from '../../domain/obs/confidence.js';
import { locateRepo } from '../../domain/obs/coordinate.js';
import { confidenceForProbe, type ProbeOutcome } from '../../domain/obs/probe.js';
import type { ObsCoordinate } from '../../domain/obs/types.js';
import { shellEnvironmentLine, shellLine } from '../../domain/shell.js';
import { placeholders } from '../../domain/template.js';
import { bindToolCommand } from '../../domain/toolchain/command.js';
import { commandOrigin, type ResolvedTool } from '../../domain/toolchain/resolve.js';
import { stderrReason } from '../../domain/toolchain/stderr.js';
import { environmentsOf, envNotFound } from '../env/names.js';
import type { LoginDeps } from '../login/deps.js';
import { expandHomeIn } from '../login/verify.js';
import { pooled } from '../pool.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';
import { findKnownRepo } from '../workspace/inspect.js';

import type { ReadyStatus, ToolExecution, UnfinishedCheck } from './types.js';

import { Readiness } from './index.js';

export interface WhereInput {
  readonly repo: string;
  readonly env?: string | undefined;
  readonly platform?: string | undefined;
  readonly check: boolean;
  readonly probe: boolean;
  readonly jobs?: number;
  readonly previewProbe?: boolean;
}

export type { ProbeOutcome } from '../../domain/obs/probe.js';

export interface WhereRow extends ObsCoordinate {
  readonly ready: ReadyStatus | null;
  readonly handoff: HandoffEnvelope | null;
  readonly unfinished?: readonly UnfinishedCheck[];
  readonly execution?: ToolExecution;
  readonly probed?: string | null;
  readonly probe_template?: readonly string[] | null;
  readonly outcome?: ProbeOutcome;
  readonly detail?: string;
  readonly suggested_confidence?: Confidence | null;
}

type ReadyColumns = Pick<WhereRow, 'ready' | 'handoff' | 'unfinished' | 'execution'>;
type ProbeColumns = Required<
  Pick<WhereRow, 'probed' | 'probe_template' | 'outcome' | 'detail' | 'suggested_confidence'>
>;

const PROBE_TIMEOUT_MS = 5000;
export class Where {
  private readonly readiness: Readiness;

  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
  ) {
    this.readiness = new Readiness(deps, login);
  }

  async execute(input: WhereInput): Promise<WhereRow[]> {
    if (input.probe && input.env === undefined) {
      throw new DevkitError('usage', 'ENV_REQUIRED', 'Probing asks a real platform; pass --env', {
        hint: 'Environments are listed by `fx env list`.',
        nextSteps: [
          workspaceCommand(this.deps, 'env', 'list'),
          workspaceCommand(this.deps, 'where', input.repo, '--env', '<env>', '--probe'),
        ],
      });
    }
    return pooled(this.coordinates(input), input.jobs ?? 4, async (coordinate) => {
      const ready = await this.ready(coordinate, input.check);
      const probe = input.probe
        ? await this.probe(coordinate, input.previewProbe ?? false, ready.execution)
        : {};
      return {
        ...coordinate,
        command: this.boundCommand(coordinate, ready.execution),
        ...ready,
        ...probe,
      };
    });
  }

  // Provider vectors can be bound safely; a manifest-authored shell template stays verbatim.
  private boundCommand(c: ObsCoordinate, execution: ToolExecution | undefined): string | null {
    if (c.command === null || !execution?.binary_path) return c.command;
    const environments = environmentsOf(this.deps.ctx, this.deps.commandShell);
    if (environments.platforms[c.platform]?.command !== undefined) return c.command;
    const binding = this.deps.ctx.platforms.find((b) => b.platform === c.platform);
    const coordinate =
      binding === undefined ? undefined : this.deps.platform(binding)?.locate(c.vars);
    if (coordinate === undefined) return c.command;
    const argv = bindToolCommand(expandHomeIn(coordinate.command, this.login.home), execution);
    return coordinate.env
      ? shellEnvironmentLine(argv, coordinate.env, this.deps.commandShell)
      : shellLine(argv, this.deps.commandShell);
  }

  private coordinates(input: WhereInput): ObsCoordinate[] {
    const repo = findKnownRepo(this.deps, input.repo);
    const environments = environmentsOf(this.deps.ctx, this.deps.commandShell);
    const envs = this.envs(input.env, Object.keys(environments.envs));
    const platforms = this.platforms(
      input.platform,
      Object.keys(environments.platforms),
      input.env,
    );
    return envs.flatMap((env) =>
      platforms.map((platform) => {
        const binding = this.deps.ctx.platforms.find((b) => b.platform === platform);
        const live = binding === undefined ? undefined : this.deps.platform(binding);
        return locateRepo({
          commandShell: this.deps.commandShell,
          repo,
          env,
          platform,
          environments,
          binding,
          locate:
            live === undefined
              ? undefined
              : (vars) => {
                  const coordinate = live.locate(vars);
                  return {
                    ...coordinate,
                    command: expandHomeIn(coordinate.command, this.login.home),
                  };
                },
        });
      }),
    );
  }

  private envs(wanted: string | undefined, known: readonly string[]): string[] {
    if (wanted !== undefined) {
      if (!known.includes(wanted)) throw envNotFound(this.deps, wanted, known);
      return [wanted];
    }
    const scope = this.deps.ctx.local.scope?.envs;
    return known.filter((e) => scope === undefined || scope.includes(e));
  }

  private platforms(wanted: string | undefined, known: readonly string[], env?: string): string[] {
    if (wanted === undefined) return [...known];
    if (known.includes(wanted)) return [wanted];
    const suggestion = nearest(wanted, known);
    throw new DevkitError(
      'not_found',
      'PLATFORM_NOT_FOUND',
      `"${wanted}" is not a platform of this workspace`,
      {
        hint: suggestionHint(suggestion, `Known: ${known.join(', ')}.`),
        nextSteps: [
          env === undefined
            ? workspaceCommand(this.deps, 'env', 'list')
            : workspaceCommand(this.deps, 'env', 'show', env),
        ],
      },
    );
  }

  private async ready(c: ObsCoordinate, check: boolean): Promise<ReadyColumns> {
    if (!check) return { ready: null, handoff: null };
    if (c.status === 'not_covered') return { ready: 'not_covered', handoff: null };
    const binding = this.deps.ctx.platforms.find((b) => b.platform === c.platform);
    const target = binding === undefined ? null : this.readiness.targetOf(binding);
    if (target === null) return { ready: 'unknown', handoff: null };
    const { status, ...evidence } = await this.readiness.judge(target, c.env);
    const { handoff, unfinished, execution } = evidence;
    return {
      ready: status,
      handoff,
      ...(unfinished === undefined ? {} : { unfinished }),
      ...(execution === undefined ? {} : { execution }),
    };
  }

  private async authorizeProbe(
    tool: ResolvedTool | null | undefined,
    vector: readonly string[],
    platform: string,
  ): Promise<void> {
    if (tool === undefined || tool === null) return;
    await this.deps.trust.gate.ensure({
      ...this.deps.trust,
      tool: tool.name,
      vector,
      origin: commandOrigin(tool),
      label: `${platform} coordinate probe`,
    });
  }

  private async probe(
    c: ObsCoordinate,
    preview: boolean,
    execution?: ToolExecution,
  ): Promise<ProbeColumns> {
    const unknown = (detail: string): ProbeColumns => ({
      probed: null,
      probe_template: null,
      outcome: 'unknown',
      detail,
      suggested_confidence: null,
    });
    if (c.status === 'not_covered') return unknown(c.notes[0] ?? 'not covered');
    const binding = this.deps.ctx.platforms.find((b) => b.platform === c.platform);
    const live = binding === undefined ? undefined : this.deps.platform(binding);
    const vector = live?.probe?.(c.vars);
    if (vector === undefined) return unknown(`${c.provider ?? c.platform} offers no probe`);
    const missing = [...new Set(vector.command.flatMap(placeholders))];
    if (missing.length > 0) return unknown(`Missing coordinate variables: ${missing.join(', ')}`);
    const tool = binding === undefined ? null : this.readiness.targetOf(binding)?.tool;
    const configured = bindToolCommand(
      expandHomeIn(vector.command, this.login.home),
      tool ? { tool: tool.name, binary: tool.binary } : undefined,
    );
    const command = bindToolCommand(configured, execution);
    if (preview)
      return {
        ...unknown('Probe planned but not executed.'),
        probe_template: vector.template ?? null,
      };
    await this.authorizeProbe(tool, configured, c.platform);
    const result = await this.deps.process
      .run(command, {
        timeoutMs: PROBE_TIMEOUT_MS,
        cwd: this.deps.ctx.root,
        diagnostic: {
          phase: `${c.platform} coordinate probe`,
          ...(binding === undefined
            ? {}
            : {
                capability: binding.capability,
                binding: binding.platform,
                ...(binding.provider === null ? {} : { provider: binding.provider }),
              }),
        },
      })
      .catch((error) => ({ code: 1, stdout: '', stderr: asDevkitError(error).code }));
    const outcome = classify(result.code);
    return {
      probed: shellLine(command, this.deps.commandShell),
      probe_template: vector.template ?? null,
      outcome,
      detail: result.code === 0 ? vector.label : stderrReason(result.stderr, result.code),
      suggested_confidence: confidenceForProbe(outcome),
    };
  }
}

function classify(code: number): ProbeOutcome {
  if (code === 0) return 'reachable';
  const category = categoryOfExitCode(code);
  if (category === 'auth' || category === 'permission') return 'unauthorized';
  if (category === 'not_found') return 'missing';
  return 'unknown';
}
