// The error tracker of the release environment, at the repository's
// coordinate there; a repository without one is not checked, and says so.

import { asDevkitError, DevkitError, toEnvelope } from '../../domain/errors.js';
import { locateRepo } from '../../domain/obs/coordinate.js';
import { coordinateFingerprint } from '../../domain/obs/observation.js';
import type {
  Issue,
  IssueFailure,
  IssuePage,
  IssueQuery,
  ObsCoordinate,
} from '../../domain/obs/types.js';
import { errorsFinding, ISSUE_CEILING } from '../../domain/release/errors.js';
import {
  notChecked,
  unanswered,
  type ErrorQueryContext,
  type ReleaseFinding,
} from '../../domain/release/types.js';
import { resolveRange, type TimeRange } from '../../domain/release/window.js';
import type { Vars } from '../../domain/template.js';
import type { ErrorTracker } from '../../ports/error-tracker.js';
import { environmentsOf } from '../env/names.js';
import { workspaceCommand } from '../workspace/guidance.js';
import { platformAs } from '../workspace/platforms.js';

import { attempt, type CheckContext } from './facts.js';
import { blockedFinding } from './gates.js';

export async function checkErrors(ctx: CheckContext): Promise<ReleaseFinding> {
  const repo = ctx.repo.name;
  const range = ctx.range ?? resolveRange({ since: ctx.policy.since }, ctx.now);
  let source: ErrorQueryContext['source'] = null;
  const result = await attempt('errors', repo, async () => {
    const env = ctx.policy.env;
    if (env === undefined)
      return notChecked('errors', repo, 'no environment for errors in the release policy');
    const tracker = platformAs<ErrorTracker>(ctx.deps, 'error-tracker', 'issues', env);
    if (tracker.platform === undefined) return unanswered('errors', repo, tracker.reason);
    const coordinate = locateRepo({
      repo: ctx.repo,
      env,
      platform: tracker.binding.platform,
      environments: environmentsOf(ctx.deps.ctx),
      binding: tracker.binding,
      locate: (vars) => tracker.platform.locate(vars),
    });
    source = querySource(coordinate, tracker.platform);
    const gate = await ctx.gates.through('error-tracker', env);
    if (!gate.open) return blockedFinding('errors', repo, gate);
    if (coordinate.status === 'not_covered')
      return notChecked(
        'errors',
        repo,
        coordinate.notes[0] ?? `no ${tracker.binding.platform} coordinate in ${env}`,
      );
    if (coordinate.command === null) return incompleteCoordinate(ctx, coordinate);
    return queryErrors({ ctx, tracker: tracker.platform, coordinate, range });
  });
  return {
    ...result,
    evidence: { ...result.evidence, query_context: contextFor(ctx, range, source) },
  };
}

function querySource(
  coordinate: ObsCoordinate,
  tracker: ErrorTracker,
): ErrorQueryContext['source'] {
  if (coordinate.status === 'not_covered' || coordinate.provider === null) return null;
  const fingerprint =
    tracker.queryFingerprint === undefined
      ? coordinateFingerprint(coordinate)
      : tracker.queryFingerprint(coordinate.vars);
  return fingerprint === null
    ? null
    : {
        platform: coordinate.platform,
        provider: coordinate.provider,
        coordinate_fingerprint: fingerprint,
      };
}

function contextFor(
  ctx: CheckContext,
  range: TimeRange,
  source: ErrorQueryContext['source'],
): ErrorQueryContext {
  return {
    repository: ctx.repo.name,
    environment: ctx.policy.env ?? null,
    range,
    observed_at: ctx.now.toISOString(),
    source,
  };
}

async function queryErrors(input: {
  readonly ctx: CheckContext;
  readonly tracker: ErrorTracker;
  readonly coordinate: ObsCoordinate;
  readonly range: TimeRange;
}): Promise<ReleaseFinding> {
  const { ctx, tracker, coordinate, range } = input;
  const page = await collectIssues(tracker, coordinate.vars, {
    since: ctx.policy.since,
    limit: ISSUE_CEILING,
    range,
    observedAt: ctx.now.toISOString(),
  });
  return errorsFinding({
    repo: ctx.repo.name,
    env: coordinate.env,
    slug: coordinate.vars['slug'] ?? coordinate.label,
    label: coordinate.label,
    since: ctx.policy.since,
    now: ctx.now,
    issues: page.issues,
    capped: page.more,
    range,
    page,
  });
}

// A bounded traversal returns partial evidence and an explicit continuation on every
// interruption. A page-sized limit must never be mistaken for a project total.
export async function collectIssues(
  tracker: ErrorTracker,
  vars: Vars,
  query: IssueQuery,
  maxPages = 100,
): Promise<IssuePage> {
  const found = new Map<string, Issue>();
  const cursors = new Set<string>();
  const failures: IssueFailure[] = [];
  let cursor = query.cursor;
  let pagesRead = 0;
  let more = true;
  let reason: string | undefined;
  let incomplete = false;
  while (pagesRead < maxPages) {
    if (cursor !== undefined) cursors.add(cursor);
    let page: IssuePage;
    try {
      page = await tracker.issues(vars, { ...query, ...(cursor === undefined ? {} : { cursor }) });
    } catch (error) {
      failures.push({ stage: 'list', error: toEnvelope(asDevkitError(error)).error });
      reason = 'page_failed';
      break;
    }
    pagesRead += page.pagesRead ?? 1;
    incomplete ||= page.coverage === 'incomplete';
    failures.push(...(page.failures ?? []));
    for (const issue of page.issues) found.set(issue.id, issue);
    more = page.more;
    cursor = page.next;
    if (!more) break;
    if (cursor === undefined) {
      reason = 'continuation_unavailable';
      break;
    }
    if (cursors.has(cursor) || page.issues.length === 0) {
      reason = 'pagination_no_progress';
      break;
    }
  }
  if (more && reason === undefined) reason = 'page_limit';
  if (reason !== undefined && reason !== 'page_failed') failures.push(paginationFailure(reason));
  return {
    issues: [...found.values()],
    more,
    pagesRead,
    coverage: incomplete || more || failures.length > 0 ? 'incomplete' : 'checked',
    failures,
    ...(more && cursor !== undefined ? { next: cursor } : {}),
    ...(reason === undefined ? {} : { truncationReason: reason }),
  };
}

function paginationFailure(reason: string): IssueFailure {
  const failure = new DevkitError(
    'server',
    'ISSUE_PAGINATION_INCOMPLETE',
    `Issue pagination stopped: ${reason}`,
    {
      nextSteps: [
        'Retry the same absolute range, or inspect the remaining cursor through the companion API.',
      ],
    },
  );
  return { stage: 'pagination', error: toEnvelope(failure).error };
}

function incompleteCoordinate(ctx: CheckContext, coordinate: ObsCoordinate): ReleaseFinding {
  const error = new DevkitError(
    'config',
    'COORDINATE_INCOMPLETE',
    `Error-tracker coordinate for ${coordinate.repo} in ${coordinate.env} is incomplete`,
    {
      hint: coordinate.notes.join('; ') || 'The platform could not construct a query coordinate.',
      nextSteps: [
        `fx where ${coordinate.repo} --env ${coordinate.env} --platform ${coordinate.platform}`,
        workspaceCommand(ctx.deps, 'manifest', 'lint'),
        'Complete the missing coordinate variables in the shared manifest, then retry.',
      ],
    },
  );
  return unanswered('errors', coordinate.repo, error.message, {
    failure: toEnvelope(error).error,
    failures: [toEnvelope(error).error],
    fix: error.nextSteps[0],
    evidence: {
      env: coordinate.env,
      coordinate: { status: coordinate.status, notes: coordinate.notes },
    },
  });
}
