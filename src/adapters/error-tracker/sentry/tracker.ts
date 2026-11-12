// Sentry metadata through the companion's stateless API pagination. The issue
// view command also fetches events, so only issue metadata endpoints are used here.

import { asDevkitError, DevkitError, toEnvelope } from '../../../domain/errors.js';
import { coordinateFingerprint } from '../../../domain/obs/observation.js';
import type { Coordinate, IssueFailure, ProbeVector } from '../../../domain/obs/types.js';
import { instantMs, isWithinRange } from '../../../domain/release/window.js';
import { placeholders, type Vars } from '../../../domain/template.js';
import type { Clock } from '../../../ports/clock.js';
import type { ErrorTracker, Issue, IssuePage, IssueQuery } from '../../../ports/error-tracker.js';
import type { Process } from '../../../ports/process.js';
import { objectOf, stringAt, unreadableError } from '../../family/cli.js';
import { TemplatePlatform } from '../../platform/template-platform.js';

import { BINARY, SentryCli, sentryFailed } from './client.js';

const LIST_TIMEOUT_MS = 60_000;
const DETAIL_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
const DETAIL_CONCURRENCY = 4;
const FIELDS =
  'id,shortId,title,level,firstSeen,lastSeen,count,permalink,culprit,status,assignedTo,filtered.firstSeen';

interface EnrichedIssue {
  readonly issue: Issue;
  readonly failures: readonly IssueFailure[];
}

export class SentryErrorTracker implements ErrorTracker {
  readonly id = BINARY;
  readonly capability = 'error-tracker' as const;
  private readonly cli: SentryCli;
  private readonly platform = new TemplatePlatform({
    id: BINARY,
    capability: 'error-tracker',
    label: 'Sentry issues for {slug}',
    command: [BINARY, 'issue', 'list', '{org}/{slug}', '--query', 'is:unresolved', '--json'],
    url: 'https://{host}/organizations/{org}/issues/?project={slug}',
  });

  constructor(
    process: Process,
    private readonly clock: Clock = { now: () => new Date() },
  ) {
    this.cli = new SentryCli(process);
  }

  queryFingerprint(vars: Vars): string | null {
    const endpoint = vars['base_url'] ?? vars['host'];
    const org = vars['org'];
    const project = projectId(vars) ?? vars['slug'];
    if (!endpoint || !org || !project) return null;
    return coordinateFingerprint({
      provider: this.id,
      vars: {
        endpoint: (endpoint.includes('://') ? endpoint : `https://${endpoint}`).replace(/\/+$/, ''),
        organization: org,
        project,
        selector: projectId(vars) === undefined ? 'slug' : 'id',
      },
    });
  }

  locate(vars: Vars): Coordinate {
    const located = this.platform.locate(vars);
    if (!vars['base_url']) return located;
    return {
      ...located,
      url: `${vars['base_url'].replace(/\/+$/, '')}/organizations/${vars['org']}/issues/`,
      env: { SENTRY_URL: vars['base_url'], SENTRY_HOST: vars['base_url'] },
    };
  }

  probe(vars: Vars): ProbeVector | undefined {
    return this.platform.probe(vars);
  }

  async issues(vars: Vars, query: IssueQuery): Promise<IssuePage> {
    const missing = ['org', ...(projectId(vars) === undefined ? ['slug'] : [])].filter(
      (key) => !vars[key]?.trim() || placeholders(vars[key] ?? '').length > 0,
    );
    if (missing.length > 0)
      throw new DevkitError(
        'config',
        'SENTRY_PROJECT_REQUIRED',
        `Sentry project coordinate is incomplete: missing ${missing.join(', ')}`,
        {
          hint: 'A repository check requires an organization and project; it must not query all projects.',
          nextSteps: ['fx manifest lint', 'fx where <repo> --env <env>'],
        },
      );
    const endpoint = `organizations/${encodeURIComponent(vars['org'] ?? '')}/issues/`;
    const period =
      query.range === undefined
        ? ['--raw-field', `statsPeriod=${query.since}`]
        : ['--raw-field', `start=${query.range.start}`, '--raw-field', `end=${query.range.end}`];
    const response = await this.metadata(
      vars,
      endpoint,
      [
        ...projectFilter(vars),
        '--raw-field',
        'sort=date',
        '--raw-field',
        `limit=${Math.min(query.limit, PAGE_SIZE)}`,
        ...period,
        ...(query.cursor === undefined ? [] : ['--cursor', query.cursor]),
      ],
      LIST_TIMEOUT_MS,
    );
    const listObservedAt = this.clock.now().toISOString();
    const rows = response['body'];
    if (!Array.isArray(rows)) throw unreadableError(BINARY, 'an issue page');
    const next = nextCursor(response);
    const enriched = await this.enrichPage(vars, query, uniqueIssues(rows, listObservedAt));
    // Later observations may resolve an earlier page's issue. Keep those records
    // until the application has deduplicated the complete traversal.
    const issues = enriched.map((item) => item.issue);
    const failures = enriched.flatMap((item) => item.failures);
    return {
      issues,
      more: next !== undefined,
      ...(next === undefined ? {} : { next }),
      pagesRead: 1,
      coverage: failures.length > 0 ? 'incomplete' : 'checked',
      failures,
    };
  }

  // Each worker takes its next item only after the preceding request settles.
  // Indexed results keep both issues and failures in provider order.
  private async enrichPage(
    vars: Vars,
    query: IssueQuery,
    listed: readonly Issue[],
  ): Promise<readonly EnrichedIssue[]> {
    const results: EnrichedIssue[] = new Array(listed.length);
    let next = 0;
    const consume = async (): Promise<void> => {
      while (next < listed.length) {
        const index = next++;
        const issue = listed[index];
        if (issue !== undefined) results[index] = await this.enrich(vars, issue, query);
      }
    };
    await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, listed.length) }, consume));
    return results;
  }

  private async metadata(
    vars: Vars,
    endpoint: string,
    args: readonly string[] = [],
    timeoutMs = DETAIL_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    const call = await this.cli.call(
      ['api', endpoint, '--method', 'GET', ...args, '--fields', FIELDS],
      timeoutMs,
      vars['base_url'] ?? vars['host'],
    );
    const response = objectOf(call.data);
    if (call.code !== 0) throw sentryFailed(call, 'read issue metadata');
    if (response === undefined || response['status'] !== 200 || response['body'] === undefined)
      throw unreadableError(BINARY, 'issue metadata');
    return response;
  }

  private async enrich(vars: Vars, listed: Issue, query: IssueQuery): Promise<EnrichedIssue> {
    const failures: IssueFailure[] = [];
    let issue: Issue = {
      ...listed,
      firstSeen: null,
      firstSeenScope: 'unknown',
      listFirstSeen: listed.firstSeen,
    };
    try {
      const response = await this.metadata(vars, `issues/${encodeURIComponent(listed.id)}/`);
      const detailObservedAt = this.clock.now().toISOString();
      const detail = issueOf(objectOf(response['body']) ?? {});
      if (detail.id !== listed.id)
        throw unreadableError(BINARY, 'issue metadata with the requested id');
      issue = {
        ...issue,
        status: detail.status ?? null,
        statusObservedAt: detailObservedAt,
        assignee: detail.assignee ?? null,
      };
      const firstSeen = lifetimeFirstSeen(detail);
      issue = { ...issue, firstSeen, firstSeenScope: 'lifetime' };
      if (detail.status === null)
        throw new DevkitError(
          'parse',
          'ISSUE_STATUS_UNKNOWN',
          'Issue current status is unavailable',
        );
      if (
        query.range !== undefined &&
        listed.windowFirstSeen !== null &&
        listed.windowFirstSeen !== undefined &&
        !isWithinRange(listed.windowFirstSeen, query.range)
      )
        throw new DevkitError(
          'parse',
          'ISSUE_ACTIVITY_OUTSIDE_RANGE',
          'Issue activity metadata falls outside the requested range',
        );
    } catch (error) {
      failures.push({
        stage: 'detail',
        issue_id: listed.id,
        error: toEnvelope(asDevkitError(error)).error,
      });
    }
    return { issue, failures };
  }
}

function issueOf(row: Record<string, unknown>): Issue {
  const id = stringAt(row, 'id');
  if (id === undefined || id.length === 0) throw unreadableError(BINARY, 'an issue id');
  const count = row['count'];
  return {
    id,
    shortId: stringAt(row, 'shortId') ?? id,
    title: stringAt(row, 'title') ?? '',
    level: stringAt(row, 'level') ?? 'error',
    firstSeen: stringAt(row, 'firstSeen') ?? null,
    windowFirstSeen: stringAt(objectOf(row['filtered']) ?? {}, 'firstSeen') ?? null,
    lastSeen: stringAt(row, 'lastSeen') ?? null,
    count: typeof count === 'number' ? count : Number(count ?? 0) || 0,
    url: stringAt(row, 'permalink') ?? null,
    culprit: stringAt(row, 'culprit') ?? null,
    status: stringAt(row, 'status') ?? null,
    assignee: objectOf(row['assignedTo']) ?? null,
  };
}

function nextCursor(response: Record<string, unknown>): string | undefined {
  const raw = response['pagination'];
  if (raw === undefined) return undefined;
  const pagination = objectOf(raw);
  if (pagination === undefined) throw unreadableError(BINARY, 'issue pagination');
  const next = pagination['nextCursor'];
  if (next === undefined || next === null) return undefined;
  if (typeof next !== 'string' || next.length === 0)
    throw unreadableError(BINARY, 'an issue continuation cursor');
  return next;
}

function lifetimeFirstSeen(detail: Issue): string {
  if (detail.firstSeen === null || instantMs(detail.firstSeen) === undefined)
    throw new DevkitError(
      'parse',
      'ISSUE_FIRST_SEEN_UNKNOWN',
      'Issue lifetime first-seen is unavailable',
    );
  return detail.firstSeen;
}

function uniqueIssues(rows: readonly unknown[], observedAt: string): readonly Issue[] {
  const issues = new Map<string, Issue>();
  for (const row of rows) {
    const issue = issueOf(objectOf(row) ?? {});
    if (!issues.has(issue.id)) issues.set(issue.id, { ...issue, statusObservedAt: observedAt });
  }
  return [...issues.values()];
}

function projectFilter(vars: Vars): readonly string[] {
  const id = projectId(vars);
  if (id !== undefined)
    return ['--raw-field', 'query=is:unresolved', '--raw-field', `project=${id}`];
  return ['--raw-field', `query=project:${JSON.stringify(vars['slug'] ?? '')} is:unresolved`];
}

function projectId(vars: Vars): string | undefined {
  const id = vars['id'];
  return id !== undefined && /^[1-9]\d*$/.test(id) ? id : undefined;
}
