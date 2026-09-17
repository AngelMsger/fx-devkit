// Plan repository updates and aggregate repository and resource-stage outcomes.

import {
  asDevkitError,
  DevkitError,
  toEnvelope,
  withPartialResult,
  type ErrorEnvelope,
} from '../domain/errors.js';
import { hasPreparationIssue } from '../domain/preparation.js';
import {
  planSync,
  type DiskState,
  type PlanItem,
  type Readability,
} from '../domain/workspace/plan.js';

import { pooled } from './pool.js';
import { assertWritable, type WritePosture } from './safety/posture.js';
import type { WorkspaceDeps } from './workspace/deps.js';
import {
  checkoutDir,
  inspectDisk,
  readabilityOf,
  resolveUser,
  urlsFor,
} from './workspace/inspect.js';

export type SyncStage = string;

export type StageSummary = Readonly<Record<string, number | string>>;

export interface StageResult {
  readonly summary: StageSummary;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SyncStages {
  readonly [id: string]: (() => Promise<StageResult>) | undefined;
}

export interface SyncInput {
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly jobs: number;
  readonly only?: SyncStage | readonly SyncStage[] | undefined;
  readonly stages?: SyncStages | undefined;
}

export interface SyncItem extends PlanItem {
  readonly result: 'planned' | 'done' | 'skipped' | 'failed';
  readonly outcome?: string;
  readonly origin_added?: boolean;
  readonly error?: string;
  readonly failure?: ErrorEnvelope['error'];
}

export interface SyncSummary {
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  readonly unreadable: number;
}

export interface SyncOutput {
  readonly operation: 'preview' | 'apply';
  readonly preparation_complete: boolean | null;
  readonly items: readonly SyncItem[];
  readonly summary: SyncSummary;
  readonly stages: Readonly<Record<string, StageSummary | 'not_implemented'>>;
  readonly stage_details?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export class Sync {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(input: SyncInput): Promise<SyncOutput> {
    const only = input.only;
    const empty: SyncOutput = {
      operation: input.dryRun ? 'preview' : 'apply',
      preparation_complete: input.dryRun ? null : true,
      items: [],
      summary: { done: 0, skipped: 0, failed: 0, unreadable: 0 },
      stages: {},
    };
    const services = input.stages?.['services'];
    const prepare =
      services &&
      (only === undefined ||
        only === 'services' ||
        (Array.isArray(only) && only.includes('services')))
        ? await services()
        : undefined;
    let repos = empty;
    let repositoriesInspected = false;
    const prepared = prepare
      ? {
          stages: { services: prepare.summary },
          stage_details: { services: prepare.details ?? {} },
        }
      : { stages: {}, stage_details: {} };
    try {
      repos =
        only === undefined || (typeof only === 'string' ? only === 'repos' : only.includes('repos'))
          ? await this.repos(input)
          : empty;
      repositoriesInspected = true;
      const later = await this.laterStages(input);
      const output = {
        ...repos,
        stages: { ...prepared.stages, ...later.stages },
        ...(prepare || later.stage_details
          ? { stage_details: { ...prepared.stage_details, ...later.stage_details } }
          : {}),
      };
      return {
        ...output,
        operation: empty.operation,
        preparation_complete: input.dryRun ? null : !hasPreparationIssue(output),
      };
    } catch (error) {
      if (!prepare && !repositoriesInspected) throw error;
      const partial = asDevkitError(error).partialResult as Partial<SyncOutput> | undefined;
      throw withPartialResult(error, {
        ...repos,
        ...partial,
        operation: empty.operation,
        preparation_complete: input.dryRun ? null : false,
        stages: { ...prepared.stages, ...partial?.stages },
        stage_details: { ...prepared.stage_details, ...partial?.stage_details },
      });
    }
  }

  private async repos(input: SyncInput): Promise<SyncOutput> {
    const total = this.deps.ctx.workspace.repos.length;
    let phase = 'preflight';
    let completed = 0;
    const active = new Set<string>();
    const started = Date.now();
    const progress = (): void =>
      this.deps.reporter.progress({
        id: 'repos',
        state: 'running',
        total,
        completed,
        elapsed_ms: Date.now() - started,
        active: [...active],
        phase,
        detail: `${phase}: ${completed}/${total} complete; ${[...active].join(', ')}; ${Math.floor((Date.now() - started) / 1000)}s elapsed`,
      });
    progress();
    const heartbeat = setInterval(progress, 5000);
    let items: SyncItem[];
    try {
      const plan = await this.plan(input.jobs, active, () => {
        completed += 1;
      });
      if (input.dryRun) return finish(plan.map((item) => ({ ...item, result: 'planned' })));
      if (plan.some((item) => item.action === 'clone' || item.fetch || item.origin !== undefined))
        assertWritable(input.posture, 'sync');
      phase = 'apply';
      completed = 0;
      progress();
      items = await pooled(plan, input.jobs, async (item) => {
        if (item.action === 'skip_unpicked') return { ...item, result: 'skipped' };
        active.add(item.name);
        try {
          return await this.apply(item);
        } finally {
          active.delete(item.name);
          completed += 1;
        }
      });
    } finally {
      clearInterval(heartbeat);
      progress();
    }
    const output = finish(items);
    if (output.summary.failed > 0) {
      this.deps.reporter.notice({
        code: 'SYNC_PARTIAL',
        message: `${output.summary.failed} repositor${output.summary.failed === 1 ? 'y' : 'ies'} could not be synced; see the failed rows`,
        nextSteps: ['fx status', 'fx sync'],
      });
    }
    return output;
  }

  private async laterStages(
    input: SyncInput,
  ): Promise<Pick<SyncOutput, 'stages' | 'stage_details'>> {
    const wanted = (stage: Exclude<SyncStage, 'repos'>): boolean =>
      input.only === undefined ||
      (typeof input.only === 'string' ? input.only === stage : input.only.includes(stage));
    const stages: Record<string, StageSummary | 'not_implemented'> = {};
    const details: Record<string, Readonly<Record<string, unknown>>> = {};
    const selected = typeof input.only === 'string' ? [input.only] : (input.only ?? []);
    for (const stage of new Set([...Object.keys(input.stages ?? {}), ...selected])) {
      if (stage === 'repos' || stage === 'services') continue;
      if (!wanted(stage)) continue;
      const run = input.stages?.[stage];
      if (run === undefined) {
        stages[stage] = 'not_implemented';
      } else {
        try {
          const result = await run();
          stages[stage] = result.summary;
          if (result.details !== undefined) details[stage] = result.details;
        } catch (error) {
          stages[stage] = { status: 'failed' };
          details[stage] = {
            ...asDevkitError(error).partialResult,
            failure: toEnvelope(asDevkitError(error)).error,
          };
          for (const pending of new Set([...Object.keys(input.stages ?? {}), ...selected])) {
            if (
              pending !== 'repos' &&
              pending !== 'services' &&
              wanted(pending) &&
              stages[pending] === undefined
            )
              stages[pending] = { status: 'not_started' };
          }
          throw withPartialResult(error, { stages, stage_details: details });
        }
      }
    }
    return { stages, ...(Object.keys(details).length === 0 ? {} : { stage_details: details }) };
  }

  private async plan(
    jobs: number,
    active: Set<string>,
    complete: () => void,
  ): Promise<readonly PlanItem[]> {
    const { ctx } = this.deps;
    const inspected = await pooled(ctx.workspace.repos, jobs, async (repo) => {
      active.add(repo.name);
      try {
        const state = await inspectDisk(this.deps, repo);
        const readability =
          state.kind === 'absent' ? await readabilityOf(this.deps, repo) : undefined;
        return { repo, state, readability };
      } finally {
        active.delete(repo.name);
        complete();
      }
    });
    const states: Record<string, DiskState> = Object.fromEntries(
      inspected.map(({ repo, state }) => [repo.name, state]),
    );
    const readability: Record<string, Readability> = Object.fromEntries(
      inspected.flatMap(({ repo, readability }) =>
        readability === undefined ? [] : [[repo.name, readability]],
      ),
    );
    const wantsOrigin = (s: DiskState): boolean =>
      s.kind === 'absent' || (s.kind === 'checkout' && s.remotes['origin'] === undefined);
    const user = Object.values(states).some(wantsOrigin) ? await this.user() : undefined;
    const urls = Object.fromEntries(
      ctx.workspace.repos.map((repo) => [repo.name, urlsFor(this.deps, repo, user)]),
    );
    const projects = ctx.manifest.workspace.result.doc.projects ?? {};
    const contacts = Object.fromEntries(
      Object.entries(projects).flatMap(([name, p]) =>
        p.contact === undefined ? [] : [[name, p.contact]],
      ),
    );
    return planSync({
      repos: ctx.workspace.repos,
      available: ctx.workspace.available,
      states,
      readability,
      urls,
      contacts,
    }).items;
  }

  private async user(): Promise<string | undefined> {
    try {
      return await resolveUser(this.deps);
    } catch (err) {
      if (
        !(err instanceof DevkitError) ||
        ![
          'CODE_HOST_AUTH',
          'TOOL_MISSING',
          'LOGIN_REQUIRED',
          'VECTOR_UNTRUSTED',
          'PROCESS_TIMEOUT',
          'PROVIDER_UNBOUND',
          'PROVIDER_UNKNOWN',
          'PROVIDER_VAR_MISSING',
        ].includes(err.code)
      )
        throw err;
      this.deps.reporter.notice({
        code: 'CODE_HOST_USER_UNKNOWN',
        message: `no origin remote can be set: ${err instanceof Error ? err.message : String(err)}`,
        nextSteps: ['fx config set user <your code-host user name>', 'fx repo fork <name>'],
      });
      return undefined;
    }
  }

  private async apply(item: PlanItem): Promise<SyncItem> {
    const { git, reporter } = this.deps;
    const dir = checkoutDir(this.deps, item);
    reporter.progress({ id: item.name, state: 'start', detail: item.action });
    // A remote added before a later step fails is still added; the row says so either way.
    let added: Pick<SyncItem, 'origin_added'> = {};
    try {
      if (item.action === 'clone' && item.upstream !== undefined && item.branch !== undefined) {
        await git.clone({ dir, upstream: item.upstream, origin: item.origin, branch: item.branch });
        reporter.progress({ id: item.name, state: 'done', detail: 'cloned' });
        return { ...item, result: 'done' };
      }
      if (item.origin !== undefined) {
        await git.addRemote(dir, 'origin', item.origin);
        added = { origin_added: true };
      }
      if (item.fetch) await git.fetch(dir, 'upstream');
      if (item.action === 'fast_forward' && item.branch !== undefined) {
        const outcome = await git.fastForward(dir, 'upstream', item.branch);
        const result = outcome === 'diverged' ? 'skipped' : 'done';
        reporter.progress({
          id: item.name,
          state: result === 'done' ? 'done' : 'skip',
          detail: outcome,
        });
        return { ...item, ...added, result, outcome };
      }
      reporter.progress({ id: item.name, state: 'skip', detail: item.reason ?? item.action });
      return { ...item, ...added, result: 'skipped' };
    } catch (err) {
      const failure = toEnvelope(asDevkitError(err)).error;
      const message = failure.message;
      reporter.progress({ id: item.name, state: 'fail', detail: message });
      return { ...item, ...added, result: 'failed', error: message, failure };
    }
  }
}

function finish(items: readonly SyncItem[]): SyncOutput {
  const count = (result: SyncItem['result']): number =>
    items.filter((i) => i.result === result).length;
  return {
    operation: items.some((item) => item.result === 'planned') ? 'preview' : 'apply',
    preparation_complete: items.some((item) => item.result === 'planned')
      ? null
      : !hasPreparationIssue(items),
    items,
    summary: {
      done: count('done'),
      skipped: count('skipped'),
      failed: count('failed'),
      unreadable: items.filter((i) => i.action === 'unreadable').length,
    },
    stages: {},
  };
}
