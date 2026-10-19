// Plan repository updates and aggregate repository and resource-stage outcomes.

import { asDevkitError, toEnvelope, withPartialResult } from '../../domain/errors.js';
import {
  preparationCheck,
  type PreparationAction,
  type PreparationCheck,
} from '../../domain/preparation.js';
import { leavesCheckoutUsable, type PlanItem } from '../../domain/workspace/plan.js';
import { requireUsableManifest } from '../manifest/prepare.js';
import { pooled } from '../pool.js';
import { workspacePreparation } from '../preparation.js';
import { assertWritable } from '../safety/posture.js';
import { Tally } from '../tally.js';
import { prepareUpstream } from '../workspace/adopt.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { checkoutDir } from '../workspace/inspect.js';
import { planRepositories } from '../workspace/plan.js';

import {
  isAdvisoryStage,
  type StageSummary,
  type SyncInput,
  type SyncItem,
  type SyncOutput,
} from './types.js';

export class Sync {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(input: SyncInput): Promise<SyncOutput> {
    requireUsableManifest(this.deps.ctx.manifest);
    const wanted = selectedStages(input);
    const stages: Record<string, StageSummary | 'not_implemented'> = {};
    const details: Record<string, Readonly<Record<string, unknown>>> = {};
    const checks: PreparationCheck[] = [];
    let items: readonly SyncItem[] = [];
    const output = (): SyncOutput => ({
      operation: input.dryRun ? 'preview' : 'apply',
      preparation: workspacePreparation(this.deps, {
        stages: wanted,
        checks,
        preview: input.dryRun,
        resume: syncRecovery(this.deps, input, wanted),
      }),
      items,
      summary: repositorySummary(items),
      stages,
      stage_details: details,
    });
    const ordered = wanted;
    for (const [index, stage] of ordered.entries()) {
      try {
        if (stage === 'repos') {
          items = await this.repos(input);
          checks.push(...repositoryChecks(items));
          continue;
        }
        const run = input.stages?.[stage];
        if (!run) {
          stages[stage] = 'not_implemented';
          checks.push(preparationCheck(stage, 'unknown', `The ${stage} stage is unavailable`));
          continue;
        }
        const result = await run();
        stages[stage] = result.summary;
        if (result.details) details[stage] = result.details;
        checks.push(...result.checks);
        if (input.only !== undefined) checks.push(...(result.operationChecks ?? []));
      } catch (error) {
        if (stage === 'repos' && index === 0 && items.length === 0) throw error;
        const failure = asDevkitError(error);
        stages[stage] = { status: 'failed' };
        details[stage] = { ...failure.partialResult, failure: toEnvelope(failure).error };
        checks.push(
          preparationCheck(stage, 'blocked', failure.message, {
            code: failure.code,
            failure: toEnvelope(failure).error,
            required: input.only !== undefined || !isAdvisoryStage(stage),
          }),
        );
        if (input.only === undefined && isAdvisoryStage(stage)) continue;
        markPending(ordered.slice(index + 1), stage, stages, checks);
        throw withPartialResult(error, output());
      }
    }
    return output();
  }

  private async repos(input: SyncInput): Promise<readonly SyncItem[]> {
    const items = await Tally.during(this.deps.activity, 'repos', (tally) =>
      this.reconcile(input, tally),
    );
    const summary = repositorySummary(items);
    if (summary.failed > 0) {
      this.deps.reporter.notice({
        code: 'SYNC_PARTIAL',
        message: `${summary.failed} repositor${summary.failed === 1 ? 'y' : 'ies'} could not be synced; see the failed rows`,
        nextSteps: ['fx status', 'fx sync'],
      });
    }
    return items;
  }

  // A watcher follows the tally as it moves. A program reads it as a record when each
  // phase begins, every five seconds after that and once more at the end.
  private async reconcile(input: SyncInput, tally: Tally): Promise<readonly SyncItem[]> {
    const total = this.deps.ctx.workspace.repos.length;
    const started = Date.now();
    let phase = 'preflight';
    const record = (): void => {
      const { completed, active } = tally.count;
      const elapsed = Date.now() - started;
      this.deps.reporter.progress({
        id: 'repos',
        state: 'running',
        total,
        completed,
        elapsed_ms: elapsed,
        active,
        phase,
        detail: `${phase}: ${completed}/${total} complete; ${active.join(', ')}; ${Math.floor(elapsed / 1000)}s elapsed`,
      });
    };
    const enter = (next: string, units: number): void => {
      phase = next;
      tally.enter(phase).plan(units);
      record();
    };
    enter('preflight', total);
    const heartbeat = setInterval(record, 5000);
    try {
      const plan = await planRepositories(this.deps, { jobs: input.jobs, tally });
      if (input.dryRun) return plan.map((item) => ({ ...item, result: 'planned' as const }));
      if (plan.some(needsRepositoryWrite)) assertWritable(input.posture, 'sync');
      const picked = (item: PlanItem): boolean => item.action !== 'skip_unpicked';
      enter('apply', plan.filter(picked).length);
      return await pooled(plan, input.jobs, async (item) =>
        picked(item)
          ? tally.unit(item.name, () => this.apply(item))
          : { ...item, result: 'skipped' as const },
      );
    } finally {
      clearInterval(heartbeat);
      record();
    }
  }

  private async apply(item: PlanItem): Promise<SyncItem> {
    const { git, reporter } = this.deps;
    const dir = checkoutDir(this.deps, item);
    reporter.progress({ id: item.name, state: 'start', detail: item.action });
    // A remote added before a later step fails is still added; the row says so either way.
    let added: Pick<SyncItem, 'origin_added' | 'upstream_added'> = {};
    try {
      if (item.action === 'clone' && item.upstream !== undefined && item.branch !== undefined) {
        await git.clone({ dir, upstream: item.upstream, origin: item.origin, branch: item.branch });
        reporter.progress({ id: item.name, state: 'done', detail: 'cloned' });
        return { ...item, result: 'done' };
      }
      if (item.upstream_to_add !== undefined)
        added = { upstream_added: await prepareUpstream(this.deps, item, dir) };
      if (item.origin !== undefined) {
        await git.addRemote(dir, 'origin', item.origin);
        added = { ...added, origin_added: true };
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

function repositorySummary(items: readonly SyncItem[]): SyncOutput['summary'] {
  const count = (result: SyncItem['result']): number =>
    items.filter((item) => item.result === result).length;
  return {
    done: count('done'),
    skipped: count('skipped'),
    failed: count('failed'),
    unreadable: items.filter((item) => item.action === 'unreadable').length,
  };
}

function repositoryChecks(items: readonly SyncItem[]): PreparationCheck[] {
  return items
    .filter((item) => item.action !== 'skip_unpicked')
    .map((item) => {
      const ready =
        item.result !== 'failed' &&
        item.outcome !== 'diverged' &&
        leavesCheckoutUsable(item.action);
      let state: PreparationCheck['state'] = ready ? 'ready' : 'blocked';
      if (item.result === 'planned') state = 'unknown';
      return preparationCheck(
        `repo:${item.name}`,
        state,
        item.error ?? item.reason ?? item.result,
        {
          resource: item.name,
          owner: item.action === 'unreadable' ? 'external' : 'user',
          ...(item.failure ? { failure: item.failure, code: item.failure.code } : {}),
        },
      );
    });
}

function needsRepositoryWrite(item: PlanItem): boolean {
  return (
    item.action === 'clone' ||
    item.fetch ||
    item.origin !== undefined ||
    item.upstream_to_add !== undefined
  );
}

function selectedStages(input: SyncInput): string[] {
  let requested = input.only ?? ['repos', ...Object.keys(input.stages ?? {})];
  if (typeof requested === 'string') requested = [requested];
  const wanted = new Set(requested);
  return [
    ...new Set(['services', 'setup', 'repos', ...Object.keys(input.stages ?? {}), ...requested]),
  ].filter((stage) => wanted.has(stage));
}

function syncRecovery(
  deps: WorkspaceDeps,
  input: SyncInput,
  stages: readonly string[],
): PreparationAction | undefined {
  if (input.initializing) return undefined;
  return {
    id: 'resume-sync',
    description: 'Retry the selected synchronization after resolving blockers',
    argv: [
      'fx',
      'sync',
      '--workspace',
      deps.ctx.name,
      '--no-refresh-manifest',
      ...(input.only === undefined ? [] : ['--only', stages.join(',')]),
    ],
    cwd: deps.ctx.root,
    actor: 'agent',
    requires_approval: input.dryRun,
  };
}

function markPending(
  pending: readonly string[],
  failedStage: string,
  stages: Record<string, StageSummary | 'not_implemented'>,
  checks: PreparationCheck[],
): void {
  for (const stage of pending) {
    stages[stage] = { status: 'not_started' };
    checks.push(
      preparationCheck(stage, 'blocked', `Not started after ${failedStage} failed`, {
        required: !isAdvisoryStage(stage),
      }),
    );
  }
}
