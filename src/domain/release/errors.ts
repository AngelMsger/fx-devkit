// Unresolved issues first seen inside the window. The tracker answers with
// activity, so first-seen is judged here; see "Unresolved errors" in
// docs/design/release.md.

import type { Issue, IssuePage } from '../obs/types.js';
import type { Level } from '../report.js';

import { releaseFinding, type ReleaseFinding } from './types.js';
import { instantMs, isWithinRange, resolveRange, type TimeRange } from './window.js';

// Maximum page size; the application continues until exhaustion or an explicit partial result.
export const ISSUE_CEILING = 1000;

export interface ErrorsInput {
  readonly repo: string;
  readonly env: string;
  readonly slug: string;
  // The project as the tracker names it, such as "Sentry issues for fx-api".
  readonly label: string;
  readonly since: string;
  readonly now: Date;
  readonly issues: readonly Issue[];
  readonly capped: boolean;
  readonly range?: TimeRange;
  readonly page?: IssuePage;
}

export function errorsFinding(input: ErrorsInput): ReleaseFinding {
  const range = input.range ?? resolveRange({ since: input.since }, input.now);
  const candidates = input.issues.filter(
    (issue) => issue.status !== 'resolved' && issue.status !== 'ignored',
  );
  const dated = candidates.flatMap((issue) => {
    const at =
      hasLifetimeDate(issue) && issue.firstSeen !== null ? instantMs(issue.firstSeen) : undefined;
    return at === undefined ? [] : [{ issue, at }];
  });
  const fresh = dated.filter((d) => isWithinRange(d.issue.firstSeen, range)).map((d) => d.issue);
  const undated = candidates.length - dated.length;
  const failures = input.page?.failures?.map((failure) => failure.error) ?? [];
  const incomplete =
    input.capped || undated > 0 || input.page?.coverage === 'incomplete' || failures.length > 0;
  const evidence = {
    env: input.env,
    slug: input.slug,
    since: input.since,
    capped: input.capped,
    undated,
    error_evidence: errorEvidence(input, range),
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
  const [level, said] = verdict(input, fresh.length, undated);
  const firstFailure = input.page?.pagesRead === 0 ? input.page.failures?.[0] : undefined;
  const suffix = fresh.length > 0 && incomplete ? '; evidence is incomplete' : '';
  const message = firstFailure?.error.message ?? `${said} (${input.label})${suffix}`;
  return releaseFinding('errors', input.repo, level, message, {
    evidence,
    coverage: incomplete ? 'incomplete' : 'checked',
    ...(failures.length === 0
      ? {}
      : {
          failure: failures[0],
          failures,
          handoff: failures[0]?.handoff,
          fix: failures.find((failure) => failure.next_steps.length > 0)?.next_steps[0],
        }),
  });
}

function verdict(input: ErrorsInput, fresh: number, undated: number): [Level, string] {
  const window =
    input.range === undefined
      ? `first seen in ${input.env} in the last ${input.since}`
      : `first seen in ${input.env} in [${input.range.start}, ${input.range.end})`;
  if (fresh > 0) {
    const floor = input.capped ? 'at least ' : '';
    return ['fail', `${floor}${fresh} unresolved issue${fresh === 1 ? '' : 's'} ${window}`];
  }
  // Without a first-seen date nothing can be said about when it appeared.
  if (undated > 0)
    return [
      'warn',
      `${undated} unresolved issue${undated === 1 ? '' : 's'} in ${input.env} undated`,
    ];
  // The tracker stopped at the ceiling: what it did not send is unread, not absent.
  if (input.capped)
    return ['warn', `more unresolved issues than fx asked for; none of them ${window}`];
  if (input.page?.coverage === 'incomplete')
    return ['warn', `unresolved issue evidence in ${input.env} is incomplete`];
  return ['ok', `no unresolved issue ${window}`];
}

function errorEvidence(input: ErrorsInput, range: TimeRange): object {
  const page = input.page;
  return {
    range,
    observed_at: input.now.toISOString(),
    activity_scope: 'range',
    status_filter: 'unresolved',
    status_scope: 'current',
    deduplication: 'latest_observation',
    // Each request observes current state at its own time; there is no shared snapshot.
    status_observed_at: null,
    items: input.issues.map((issue) => ({
      id: issue.id,
      short_id: issue.shortId,
      title: issue.title,
      level: issue.level,
      lifetime_first_seen: hasLifetimeDate(issue) ? issue.firstSeen : null,
      first_seen_scope: hasLifetimeDate(issue) ? 'lifetime' : 'unknown',
      list_first_seen: issue.listFirstSeen ?? null,
      list_first_seen_scope: 'unknown',
      window_first_seen: issue.windowFirstSeen ?? null,
      last_seen: issue.lastSeen,
      count: issue.count,
      count_scope: 'unknown',
      url: issue.url,
      culprit: issue.culprit,
      status: issue.status ?? null,
      status_observed_at: issue.statusObservedAt ?? null,
      assignee: issue.assignee ?? null,
    })),
    has_more: input.capped,
    ...(page?.next === undefined ? {} : { next: page.next }),
    pages_read: page?.pagesRead ?? 1,
    coverage:
      input.capped ||
      input.issues.some((issue) => !hasLifetimeDate(issue)) ||
      (page?.failures?.length ?? 0) > 0
        ? 'incomplete'
        : (page?.coverage ?? 'checked'),
    failures: page?.failures ?? [],
    truncation_reason: page?.truncationReason ?? null,
  };
}

function hasLifetimeDate(issue: Issue): boolean {
  return (
    issue.firstSeenScope !== 'unknown' &&
    issue.firstSeen !== null &&
    instantMs(issue.firstSeen) !== undefined
  );
}
