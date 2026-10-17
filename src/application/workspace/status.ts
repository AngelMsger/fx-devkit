// One row per tracked repository, from the disk state and the manifest alone.
// `--fetch` refreshes the remote-tracking refs first; without it the position
// against upstream is as of the last sync.

import type { ResolvedRepo } from '../../domain/manifest/local.js';
import type { DiskState } from '../../domain/workspace/plan.js';
import { deriveStatus, type StatusRow } from '../../domain/workspace/status.js';
import { pooled } from '../pool.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { Tally } from '../tally.js';

import type { WorkspaceDeps } from './deps.js';
import { checkoutDir, inspectDisk, urlsFor } from './inspect.js';

export type StatusInput =
  | { readonly fetch: false; readonly dirtyOnly: boolean; readonly jobs?: number }
  | {
      readonly fetch: true;
      readonly dirtyOnly: boolean;
      readonly dryRun: boolean;
      readonly posture: WritePosture;
      readonly jobs?: number;
    };

export type StatusFetch = 'not_requested' | 'not_applicable' | 'planned' | 'completed';

export interface StatusItem extends StatusRow {
  readonly fetch: StatusFetch;
}

interface StatusPlanItem {
  readonly repo: ResolvedRepo;
  readonly disk: DiskState;
  readonly fetch: StatusFetch;
}

export class Status {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(input: StatusInput): Promise<StatusItem[]> {
    const { activity } = this.deps;
    const { repos } = this.deps.ctx.workspace;
    const plan: StatusPlanItem[] = await Tally.during(activity, 'repos', (tally) => {
      tally.plan(repos.length);
      return pooled(repos, input.jobs ?? 4, (repo) =>
        tally.unit(repo.name, async () => {
          const disk = await inspectDisk(this.deps, repo);
          return { repo, disk, fetch: planFetch(input.fetch, disk) };
        }),
      );
    });
    const writes = plan.filter((item) => item.fetch === 'planned');
    if (!input.fetch || input.dryRun || writes.length === 0) return this.rows(input, plan);
    assertWritable(input.posture, 'status --fetch');
    return Tally.during(activity, 'fetch', async (tally) => {
      tally.plan(writes.length);
      const fetched: StatusPlanItem[] = [];
      for (const item of plan)
        fetched.push(
          item.fetch === 'planned'
            ? await tally.unit(item.repo.name, () => this.fetch(item))
            : item,
        );
      return this.rows(input, fetched);
    });
  }

  private async fetch({ repo }: StatusPlanItem): Promise<StatusPlanItem> {
    await this.deps.git.fetch(checkoutDir(this.deps, repo), 'upstream');
    return { repo, disk: await inspectDisk(this.deps, repo), fetch: 'completed' };
  }

  private rows(input: StatusInput, plan: readonly StatusPlanItem[]): StatusItem[] {
    const rows = plan.map((item): StatusItem => ({
      ...deriveStatus(item.repo, item.disk, urlsFor(this.deps, item.repo, undefined).upstream),
      fetch: item.fetch,
    }));
    return input.dirtyOnly ? rows.filter((r) => r.uncommitted) : rows;
  }
}

function planFetch(requested: boolean, disk: DiskState): StatusFetch {
  if (!requested) return 'not_requested';
  return disk.kind === 'checkout' ? 'planned' : 'not_applicable';
}
