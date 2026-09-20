// One repository in full: the resolved entry, its disk state, its URLs and,
// when the members document is there, who owns it.

import type { ResolvedRepo } from '../../domain/manifest/local.js';
import { ownersOf, type Ownership } from '../../domain/members/owners.js';
import { deriveStatus, type StatusRow } from '../../domain/workspace/status.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import {
  contactFor,
  findKnownRepo,
  inspectDisk,
  urlsFor,
  webUrlFor,
} from '../workspace/inspect.js';

export interface RepoDetail extends StatusRow {
  readonly picked: boolean;
  readonly aka: readonly string[];
  readonly links: Readonly<Record<string, string>>;
  readonly project: string | null;
  readonly tags: readonly string[];
  readonly desc: string | null;
  readonly origin: ResolvedRepo['origin'];
  readonly overridden: readonly string[];
  readonly upstream_url: string | null;
  readonly web_url: string | null;
  readonly contact: string | null;
  // null: no members document, not an unowned repository.
  readonly owners: readonly Ownership[] | null;
}

export class RepoShow {
  constructor(private readonly deps: WorkspaceDeps) {}

  async execute(input: { readonly name: string }): Promise<RepoDetail> {
    const repo = findKnownRepo(this.deps, input.name);
    const urls = urlsFor(this.deps, repo, undefined);
    const status = deriveStatus(repo, await inspectDisk(this.deps, repo), urls.upstream);
    const people = this.deps.ctx.manifest.members?.result.doc;
    return {
      ...status,
      aka: repo.aka ?? [],
      links: repo.links ?? {},
      picked: this.deps.ctx.workspace.repos.some((entry) => entry.name === repo.name),
      project: repo.project ?? null,
      tags: repo.tags,
      desc: repo.desc ?? null,
      origin: repo.origin,
      overridden: repo.overridden,
      upstream_url: urls.upstream ?? null,
      web_url: webUrlFor(this.deps, repo) ?? null,
      contact: contactFor(this.deps, repo) ?? null,
      owners: people === undefined ? null : ownersOf(people, repo.name),
    };
  }
}
