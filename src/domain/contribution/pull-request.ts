// A contribution PR names both repositories and branches. Its state comes from
// one known remote request, never from a missing response or local timestamp.

import type { RepoRef } from '../workspace/ref.js';

export interface PullRequestBranch {
  readonly repo: RepoRef;
  readonly branch: string;
}

export interface ContributionPullRequest {
  readonly id: string;
  readonly url: string;
  readonly state: 'open' | 'merged' | 'declined' | 'superseded';
  readonly source: PullRequestBranch;
  readonly target: PullRequestBranch;
}

export interface PullRequestLookup {
  readonly repo: RepoRef;
  // A native ID or repository website URL; the provider owns its syntax.
  readonly id: string;
}

export interface CreatePullRequest {
  readonly source: PullRequestBranch;
  readonly target: PullRequestBranch;
  readonly title: string;
  readonly description: string;
  readonly allowWrites: boolean;
}
