// The agent's question about a repository: where its errors, logs, builds
// and pods are in an environment, one row per platform, and whether each can
// be used right now. Coordinates come from the manifest alone; the readiness
// column runs only a provider's read-only verify, and --probe its read-only
// probe. This query never edits the manifest; explicit recording consumes
// its evidence in a separate use case.

import { asDevkitError, DevkitError, type HandoffEnvelope } from '../domain/errors.js';
import { nearest } from '../domain/fuzzy.js';
import type { Confidence } from '../domain/obs/confidence.js';
import { locateRepo } from '../domain/obs/coordinate.js';
import { confidenceForProbe, type ProbeOutcome } from '../domain/obs/probe.js';
import type { ObsCoordinate } from '../domain/obs/types.js';
import { shellLine } from '../domain/shell.js';
import { placeholders } from '../domain/template.js';
import { stderrReason } from '../domain/toolchain/stderr.js';

import { environmentsOf, envNotFound } from './env/names.js';
import type { LoginDeps } from './login/deps.js';
import { expandHomeIn } from './login/verify.js';
import { pooled } from './pool.js';
import { Readiness, type ReadyStatus } from './readiness.js';
import type { WorkspaceDeps } from './workspace/deps.js';
import { findKnownRepo } from './workspace/inspect.js';

export interface WhereInput {
  readonly repo: string;
  readonly env?: string | undefined;
  readonly platform?: string | undefined;
  readonly check: boolean;
  readonly probe: boolean;
  readonly jobs?: number;
  readonly previewProbe?: boolean;
}

export type { ProbeOutcome } from '../domain/obs/probe.js';

export interface WhereRow extends ObsCoordinate {
  readonly ready: ReadyStatus | null;
  readonly handoff: HandoffEnvelope | null;
  readonly probed?: string | null;
  readonly probe_template?: readonly string[] | null;
  readonly outcome?: ProbeOutcome;
  readonly detail?: string;
  readonly suggested_confidence?: Confidence | null;
}

type ReadyColumns = Pick<WhereRow, 'ready' | 'handoff'>;
type ProbeColumns = Required<
  Pick<WhereRow, 'probed' | 'probe_template' | 'outcome' | 'detail' | 'suggested_confidence'>
>;

const PROBE_TIMEOUT_MS = 5000;
const EXIT = { auth: 4, permission: 5, not_found: 6 } as const;
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
      throw new DevkitError('usage', 'ENV_REQUIRED', 'probing asks a real platform; pass --env', {
        hint: 'Environments are listed by `fx env list`.',
        nextSteps: ['fx env list', `fx where ${input.repo} --env <env> --probe`],
      });
    }
    return pooled(this.coordinates(input), input.jobs ?? 4, async (coordinate) => {
      const [ready, probe] = await Promise.all([
        this.ready(coordinate, input.check),
        input.probe ? this.probe(coordinate, input.previewProbe ?? false) : Promise.resolve({}),
      ]);
      return {
        ...coordinate,
        ...ready,
        ...probe,
      };
    });
  }

  private coordinates(input: WhereInput): ObsCoordinate[] {
    const repo = findKnownRepo(this.deps, input.repo);
    const environments = environmentsOf(this.deps.ctx);
    const envs = this.envs(input.env, Object.keys(environments.envs));
    const platforms = this.platforms(input.platform, Object.keys(environments.platforms));
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
      if (!known.includes(wanted)) throw envNotFound(wanted, known);
      return [wanted];
    }
    const scope = this.deps.ctx.local.scope?.envs;
    return known.filter((e) => scope === undefined || scope.includes(e));
  }

  private platforms(wanted: string | undefined, known: readonly string[]): string[] {
    if (wanted === undefined) return [...known];
    if (known.includes(wanted)) return [wanted];
    const suggestion = nearest(wanted, known);
    throw new DevkitError(
      'not_found',
      'PLATFORM_NOT_FOUND',
      `"${wanted}" is not a platform of this workspace`,
      {
        hint:
          suggestion === undefined
            ? `Known: ${known.join(', ')}.`
            : `Did you mean "${suggestion}"?`,
        nextSteps: ['fx env show <env>'],
      },
    );
  }

  private async ready(c: ObsCoordinate, check: boolean): Promise<ReadyColumns> {
    if (!check) return { ready: null, handoff: null };
    if (c.status === 'not_covered') return { ready: 'not_covered', handoff: null };
    const binding = this.deps.ctx.platforms.find((b) => b.platform === c.platform);
    const target = binding === undefined ? null : this.readiness.targetOf(binding);
    if (target === null) return { ready: 'unknown', handoff: null };
    const verdict = await this.readiness.judge(target, c.env);
    return { ready: verdict.status, handoff: verdict.handoff };
  }

  private async probe(c: ObsCoordinate, preview: boolean): Promise<ProbeColumns> {
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
    const command = expandHomeIn(vector.command, this.login.home);
    if (preview)
      return {
        ...unknown('Probe planned but not executed.'),
        probe_template: vector.template ?? null,
      };
    const result = await this.deps
      .processRun(command, {
        timeoutMs: PROBE_TIMEOUT_MS,
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
  if (code === EXIT.auth || code === EXIT.permission) return 'unauthorized';
  if (code === EXIT.not_found) return 'missing';
  return 'unknown';
}
