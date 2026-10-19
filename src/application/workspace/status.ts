// One row per tracked repository, from the disk state and the manifest alone.
// `--fetch` refreshes the remote-tracking refs first; without it the position
// against upstream is as of the last sync. The workspace answer sets the rows
// beside the workspace they describe, the root entries nothing accounts for,
// and the reason no row is listed.

import type { ResolvedRepo } from '../../domain/manifest/local.js';
import type { DiskState } from '../../domain/workspace/plan.js';
import { deriveStatus, type StatusRow } from '../../domain/workspace/status.js';
import { pooled } from '../pool.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { Tally } from '../tally.js';

import type { WorkspaceContext } from './context.js';
import type { WorkspaceDeps } from './deps.js';
import { workspaceCommand } from './guidance.js';
import { checkoutDir, inspectDisk, urlsFor } from './inspect.js';
import { strayRootEntries, type RootInventory } from './root-entries.js';

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

type StatusEmptyReason =
  | 'no_repositories_declared'
  | 'no_repositories_selected'
  | 'no_uncommitted_changes'
  | 'no_repositories';

interface WorkspaceStatusOutput {
  readonly items: StatusItem[];
  readonly workspace: string;
  readonly root: string;
  readonly selection: WorkspaceContext['selection'];
  readonly selected_repositories: number;
  readonly stray_entries: readonly string[];
  // Both present exactly when no row is listed.
  readonly empty_reason?: StatusEmptyReason;
  readonly next_steps?: readonly string[];
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

export class WorkspaceStatus {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly inventory: RootInventory,
  ) {}

  async execute(input: StatusInput): Promise<WorkspaceStatusOutput> {
    const { ctx } = this.deps;
    const items = await new Status(this.deps).execute(input);
    const strays = await strayRootEntries(this.deps, this.inventory);
    return {
      items,
      workspace: ctx.name,
      root: ctx.root,
      selection: ctx.selection,
      selected_repositories: ctx.workspace.repos.length,
      stray_entries: strays.map((entry) => entry.name),
      ...(items.length > 0 ? {} : this.explainEmpty(input.dirtyOnly)),
    };
  }

  private explainEmpty(
    dirtyOnly: boolean,
  ): Pick<WorkspaceStatusOutput, 'empty_reason' | 'next_steps'> {
    const reason = emptyReason(this.deps.ctx, dirtyOnly);
    return {
      empty_reason: reason,
      next_steps:
        reason === 'no_repositories_selected'
          ? [
              workspaceCommand(this.deps, 'repo', 'list'),
              workspaceCommand(this.deps, 'repo', 'select', '--all'),
            ]
          : [],
    };
  }
}

function emptyReason(ctx: WorkspaceContext, dirtyOnly: boolean): StatusEmptyReason {
  if (ctx.workspace.repos.length > 0)
    return dirtyOnly ? 'no_uncommitted_changes' : 'no_repositories';
  return ctx.manifest.workspace.result.doc.repos.length === 0
    ? 'no_repositories_declared'
    : 'no_repositories_selected';
}

function planFetch(requested: boolean, disk: DiskState): StatusFetch {
  if (!requested) return 'not_requested';
  return disk.kind === 'checkout' ? 'planned' : 'not_applicable';
}
