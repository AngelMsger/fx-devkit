// The workspace's repositories as one table, picked and unpicked together, so
// "what do I track" and "what could I track" are one question. Readability costs
// a code-host call per row and is asked for only when it is wanted.

import { resolveSharedRepo, type ResolvedRepo } from '../../domain/manifest/local.js';
import type { Readability } from '../../domain/workspace/plan.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { contactFor, inspectDisk, readabilityOf } from '../workspace/inspect.js';
import { scopeMode, type ScopeMode } from '../workspace/scope.js';

export interface RepoListInput {
  readonly tag?: string | undefined;
  readonly project?: string | undefined;
  readonly picked?: 'picked' | 'unpicked' | undefined;
  readonly unreadable?: boolean | undefined;
}

export interface RepoRow {
  readonly name: string;
  readonly path: string;
  readonly branch: string | null;
  readonly project: string | null;
  readonly tags: readonly string[];
  readonly picked: boolean;
  readonly selection_mode: ScopeMode;
  readonly origin: ResolvedRepo['origin'];
  readonly exists: boolean;
  readonly readability?: Readability;
  readonly contact?: string;
}

export class RepoList {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(input: RepoListInput): Promise<RepoRow[]> {
    const { repos, available } = this.deps.ctx.workspace;
    const shared = this.deps.ctx.manifest.workspace.result.doc;
    const unpicked = shared.repos
      .filter((r) => available.includes(r.name))
      .map((repo) => resolveSharedRepo({ workspace: shared, local: this.deps.ctx.local, repo }));
    const rows: RepoRow[] = [];
    for (const repo of [
      ...repos.map((r) => ({ repo: r, picked: true })),
      ...unpicked.map((r) => ({ repo: r, picked: false })),
    ]) {
      if (input.tag !== undefined && !repo.repo.tags.includes(input.tag)) continue;
      if (input.project !== undefined && repo.repo.project !== input.project) continue;
      if (input.picked !== undefined && (input.picked === 'picked') !== repo.picked) continue;
      rows.push(await this.row(repo.repo, repo.picked, input.unreadable === true));
    }
    return input.unreadable === true ? rows.filter((r) => r.readability !== 'readable') : rows;
  }

  private async row(repo: ResolvedRepo, picked: boolean, probe: boolean): Promise<RepoRow> {
    const contact = contactFor(this.deps, repo);
    return {
      name: repo.name,
      path: repo.path,
      branch: repo.branch ?? null,
      project: repo.project ?? null,
      tags: repo.tags,
      picked,
      selection_mode: scopeMode(this.deps.ctx.local.scope?.repos),
      origin: repo.origin,
      exists: (await inspectDisk(this.deps, repo)).kind !== 'absent',
      ...(probe ? { readability: await readabilityOf(this.deps, repo) } : {}),
      ...(contact === undefined ? {} : { contact }),
    };
  }
}
