// What a code host says about a repository's history, in the host-neutral
// shape the release check reasons about.

export interface Branch {
  readonly name: string;
  readonly sha: string;
  readonly default: boolean;
}

export interface Commit {
  readonly sha: string;
  readonly author: string;
  // When the commit was recorded, ISO 8601: committer time where the host
  // distinguishes it, so a rebased commit is not dated before its rewrite.
  readonly date: string;
  readonly message: string;
  readonly parents: readonly string[];
}

export interface CommitRange {
  readonly from: string;
  readonly to: string;
}
