// Where repositories live. fx never talks to a code host's API itself; a provider drives
// the host's own CLI. Readability has four states, and the query methods are read-only
// and no wider than `release` needs: branches, a range between two of them, one commit,
// one file at a ref.

import type {
  ContributionPullRequest,
  CreatePullRequest,
  PullRequestLookup,
} from '../domain/contribution/pull-request.js';
import type { RepositoryIdentity } from '../domain/contribution/remote.js';
import type { Branch, Commit, CommitRange } from '../domain/workspace/commits.js';
import type { Readability } from '../domain/workspace/plan.js';
import type { RepoRef } from '../domain/workspace/ref.js';

export type { RepoRef };

export type { Readability } from '../domain/workspace/plan.js';
export type { Branch, Commit, CommitRange } from '../domain/workspace/commits.js';

// What `release` is handed: the read-only half of a host, so a check cannot
// reach fork even by accident.
export type CodeHostQueries = Pick<CodeHost, 'branches' | 'compare' | 'commit' | 'readFile'>;

export interface ForkResult {
  readonly url: string;
  readonly created: boolean;
}

export type CodeHostContributionWrites = Pick<CodeHost, 'createPullRequest'>;

export interface CodeHost {
  readonly supportsContributions: boolean;
  repositoryIdentity(ref: RepoRef): Promise<RepositoryIdentity>;
  pullRequest(input: PullRequestLookup): Promise<ContributionPullRequest | null>;
  createPullRequest(input: CreatePullRequest): Promise<ContributionPullRequest>;
  whoami(): Promise<{ user: string }>;
  canRead(ref: RepoRef): Promise<Readability>;
  fork(ref: RepoRef): Promise<ForkResult>;
  upstreamUrl(ref: RepoRef): string;
  forkUrl(user: string, ref: RepoRef): string;
  webUrl(ref: RepoRef): string;
  branches(ref: RepoRef): Promise<Branch[]>;
  // Commits reachable from `to` and not from `from`, every page of them.
  compare(ref: RepoRef, range: CommitRange): Promise<Commit[]>;
  commit(ref: RepoRef, sha: string): Promise<Commit>;
  // undefined when the path does not exist at that ref; anything else throws.
  readFile(ref: RepoRef, path: string, at: string): Promise<string | undefined>;
}
