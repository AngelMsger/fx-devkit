// Unresolved issues first seen inside the window. The tracker answers with
// activity, so first-seen is judged here; see "Unresolved errors" in
// docs/design/release.md.

import type { Issue } from '../obs/types.js';
import type { Level } from '../report.js';

import { releaseFinding, type ReleaseFinding } from './types.js';
import { windowMs } from './window.js';

// More new issues than this are not a list a person reads; the tracker is
// asked for no more, and says whether it had more.
export const ISSUE_CEILING = 1000;

export interface ErrorsInput {
  readonly repo: string;
  readonly env: string;
  readonly slug: string;
  readonly since: string;
  readonly now: Date;
  readonly issues: readonly Issue[];
  readonly capped: boolean;
}

export function errorsFinding(input: ErrorsInput): ReleaseFinding {
  const floor = input.now.getTime() - windowMs(input.since);
  const dated = input.issues.flatMap((issue) => {
    const at = issue.firstSeen === null ? NaN : Date.parse(issue.firstSeen);
    return Number.isNaN(at) ? [] : [{ issue, at }];
  });
  const fresh = dated.filter((d) => d.at >= floor).map((d) => d.issue);
  const undated = input.issues.length - dated.length;
  const evidence = {
    env: input.env,
    slug: input.slug,
    since: input.since,
    capped: input.capped,
    undated,
    issues: fresh.map((i) => ({
      short_id: i.shortId,
      title: i.title,
      level: i.level,
      first_seen: i.firstSeen,
      last_seen: i.lastSeen,
      count: i.count,
      url: i.url,
    })),
  };
  const where = `${input.slug} (${input.env})`;
  const [level, message] = verdict(input, fresh.length, undated, where);
  return releaseFinding('errors', input.repo, level, message, {
    evidence,
    coverage: input.capped || undated > 0 ? 'incomplete' : 'checked',
  });
}

function verdict(
  input: ErrorsInput,
  fresh: number,
  undated: number,
  where: string,
): [Level, string] {
  const window = `first seen in the last ${input.since} in ${where}`;
  if (fresh > 0) {
    const floor = input.capped ? 'at least ' : '';
    return ['fail', `${floor}${fresh} unresolved issue${fresh === 1 ? '' : 's'} ${window}`];
  }
  // Without a first-seen date nothing can be said about when it appeared.
  if (undated > 0)
    return ['warn', `${undated} unresolved issue${undated === 1 ? '' : 's'} in ${where} undated`];
  // The tracker stopped at the ceiling: what it did not send is unread, not absent.
  if (input.capped)
    return [
      'warn',
      `${where} has more unresolved issues than fx asked for; none of them ${window}`,
    ];
  return ['ok', `no unresolved issue ${window}`];
}
