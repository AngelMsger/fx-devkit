// One row per tracked repository, from the disk state and the manifest alone.
// `--fetch` refreshes the remote-tracking refs first; without it the position
// against upstream is as of the last sync.

import type { ResolvedRepo } from '../domain/manifest/local.js';
import type { DiskState } from '../domain/workspace/plan.js';
import { deriveStatus, type StatusRow } from '../domain/workspace/status.js';

import { pooled } from './pool.js';
import { assertWritable, type WritePosture } from './safety/posture.js';
import type { WorkspaceDeps } from './workspace/deps.js';
import { checkoutDir, inspectDisk, urlsFor } from './workspace/inspect.js';

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
    const plan: StatusPlanItem[] = await pooled(
      this.deps.ctx.workspace.repos,
      input.jobs ?? 4,
      async (repo) => {
        const disk = await inspectDisk(this.deps, repo);
        return { repo, disk, fetch: planFetch(input.fetch, disk) };
      },
    );
    const writes = plan.filter((item) => item.fetch === 'planned');
    if (input.fetch && !input.dryRun && writes.length > 0)
      assertWritable(input.posture, 'status --fetch');

    const rows: StatusItem[] = [];
    for (const item of plan) {
      let { disk } = item;
      let fetch = item.fetch;
      if (input.fetch && !input.dryRun && fetch === 'planned') {
        const { repo } = item;
        await this.deps.git.fetch(checkoutDir(this.deps, repo), 'upstream');
        disk = await inspectDisk(this.deps, repo);
        fetch = 'completed';
      }
      rows.push({
        ...deriveStatus(item.repo, disk, urlsFor(this.deps, item.repo, undefined).upstream),
        fetch,
      });
    }
    return input.dirtyOnly ? rows.filter((r) => r.uncommitted) : rows;
  }
}

function planFetch(requested: boolean, disk: DiskState): StatusFetch {
  if (!requested) return 'not_requested';
  return disk.kind === 'checkout' ? 'planned' : 'not_applicable';
}
