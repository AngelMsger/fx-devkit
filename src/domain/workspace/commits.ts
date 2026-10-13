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

// How a person names a commit: its first seven hexadecimal digits.
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

// Two names of one commit, either of which may be abbreviated to seven digits or more.
export function sameCommit(a: string, b: string): boolean {
  const [shorter, longer] = (a.length <= b.length ? [a, b] : [b, a]).map((sha) =>
    sha.toLowerCase(),
  ) as [string, string];
  return shorter === longer || (shorter.length >= 7 && longer.startsWith(shorter));
}
