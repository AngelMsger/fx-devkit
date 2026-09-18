// The four things a release checklist asks of a repository, as the groups
// of a report whose ids are repository names.

import { finding, type Finding, type FindingExtra, type Level, type Report } from '../report.js';

export const CHECKS = ['deps', 'merge', 'ci', 'errors'] as const;
export type Check = (typeof CHECKS)[number];

export type ReleaseFinding = Finding<Check>;
export type ReleaseReport = Report<Check>;

export const RELEASE_FINDING_COLUMNS = ['group', 'level', 'id', 'message', 'fix'] as const;

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
