// The four things a release checklist asks of a repository, as the groups
// of a report whose ids are repository names, and what each repository's
// release would carry, so a verdict always names what it was about.

import { finding, type Finding, type FindingExtra, type Level, type Report } from '../report.js';

export const CHECKS = ['deps', 'merge', 'ci', 'errors'] as const;
export type Check = (typeof CHECKS)[number];

export type ReleaseFinding = Finding<Check>;

export interface Author {
  readonly id: string | null;
  readonly name: string;
}

// A commit as a release names it: by the person behind it where the members document knows them.
export interface AttributedCommit {
  readonly sha: string;
  readonly author: Author;
  readonly date: string;
  readonly message: string;
}

// A branch head as a release sees it: the commit, and the version declared there.
export interface ReleaseHead {
  readonly branch: string;
  readonly sha: string;
  // null when the host did not describe the commit.
  readonly date: string | null;
  readonly message: string | null;
  // null when the repository declares no version fx can read at this commit.
  readonly version: string | null;
}

export interface Unmerged {
  readonly commits: number;
  // The people behind those commits.
  readonly authors: number;
}

export interface ReleaseRepo {
  readonly name: string;
  // The branch a release is cut from and the one it lands on. null when the host
  // was not asked, did not answer or has no such branch; the findings say which.
  readonly source: ReleaseHead | null;
  readonly target: ReleaseHead | null;
  // Where the versions were read; null when no file declares one.
  readonly version_file: string | null;
  // How much the next merge would bring: people's commits on the source and not on the
  // target, counted; the two heads name the range for whoever wants the list. null when
  // the branches were not compared.
  readonly unmerged: Unmerged | null;
  // Why the manifest lets this repository deviate from the workspace policy.
  readonly note: string | null;
}

export type ReleaseReport = Report<Check> & { readonly repos: readonly ReleaseRepo[] };

export function releaseFinding(
  check: Check,
  repo: string,
  level: Level,
  message: string,
  extra: FindingExtra = {},
): ReleaseFinding {
  return finding(check, repo, level, message, extra);
}

// The check could not be made for a reason a person can act on: a tool
// that is not ready, a platform that did not answer.
export function unanswered(
  check: Check,
  repo: string,
  reason: string,
  extra: FindingExtra = {},
): ReleaseFinding {
  return releaseFinding(check, repo, 'warn', reason, { ...extra, coverage: 'incomplete' });
}

// The check does not apply to this repository; saying why is the answer.
export function notChecked(check: Check, repo: string, why: string): ReleaseFinding {
  return releaseFinding(check, repo, 'ok', `${why}, not checked`, { coverage: 'not_applicable' });
}
