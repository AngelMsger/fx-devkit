// Sentry through the `sentry` CLI: one token serves every environment, so
// the recipe is not per environment; coordinates differ per environment.
// The one query lists a project's unresolved issues first seen inside a
// window; the domain judges first-seen again from the dates it gets back.

import type { Coordinate, ProbeVector } from '../../../domain/obs/types.js';
import type { Vars } from '../../../domain/template.js';
import type { ErrorTracker, Issue, IssuePage, IssueQuery } from '../../../ports/error-tracker.js';
import type { Process } from '../../../ports/process.js';
import { objectOf, stringAt, unreadableError } from '../../family/cli.js';
import { TemplatePlatform } from '../../platform/template-platform.js';

import { BINARY, SentryCli, sentryFailed } from './client.js';

// The sentry CLI starts slowly and pages through the API; a busy project
// needs more than the family tools' fifteen seconds.
const QUERY_TIMEOUT_MS = 30_000;
// The CLI refuses a larger --limit.
const CLI_CEILING = 1000;
const FIELDS = 'id,shortId,title,level,firstSeen,lastSeen,count,permalink,culprit';

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

  constructor(process: Process) {
    this.cli = new SentryCli(process);
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
    const project = `${vars['org'] ?? ''}/${vars['slug'] ?? ''}`;
    const call = await this.cli.call(
      [
        'issue',
        'list',
        project,
        '--query',
        `is:unresolved firstSeen:-${query.since}`,
        '--period',
        query.since,
        '--limit',
        String(Math.min(query.limit, CLI_CEILING)),
        '--fields',
        FIELDS,
      ],
      QUERY_TIMEOUT_MS,
      vars['base_url'] ?? vars['host'],
    );
    const body = objectOf(call.data);
    const rows = body?.['data'];
    if (call.code !== 0 || !Array.isArray(rows))
      throw sentryFailed(call, `list the unresolved issues of ${project}`);
    const more = body?.['hasMore'];
    if (typeof more !== 'boolean') throw unreadableError(BINARY, `an issue page of ${project}`);
    return { issues: rows.map((row) => issueOf(objectOf(row) ?? {}, project)), more };
  }
}

function issueOf(row: Record<string, unknown>, project: string): Issue {
  const id = stringAt(row, 'id') ?? stringAt(row, 'shortId');
  if (id === undefined) throw unreadableError(BINARY, `an issue of ${project}`);
  const count = row['count'];
  return {
    id,
    shortId: stringAt(row, 'shortId') ?? id,
    title: stringAt(row, 'title') ?? '',
    level: stringAt(row, 'level') ?? 'error',
    firstSeen: stringAt(row, 'firstSeen') ?? null,
    lastSeen: stringAt(row, 'lastSeen') ?? null,
    count: typeof count === 'number' ? count : Number(count ?? 0) || 0,
    url: stringAt(row, 'permalink') ?? null,
    culprit: stringAt(row, 'culprit') ?? null,
  };
}
