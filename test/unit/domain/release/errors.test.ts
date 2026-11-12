import { describe, expect, it } from 'vitest';

import { errorsFinding } from '../../../../src/domain/release/errors.js';
import type { Issue } from '../../../../src/ports/error-tracker.js';

const issue = (shortId: string, firstSeen: string | null): Issue => ({
  id: shortId,
  shortId,
  title: `Error ${shortId}`,
  level: 'error',
  firstSeen,
  lastSeen: '2026-09-03T00:00:00Z',
  count: 3,
  url: null,
  culprit: null,
});

const base = {
  capped: false,
  repo: 'a',
  env: 'test',
  slug: 'fx-a-test',
  label: 'Sentry issues for fx-a-test',
  since: '14d',
  now: new Date('2026-09-03T00:00:00Z'),
};

describe('errorsFinding', () => {
  it('counts only issues first seen inside the window', () => {
    const out = errorsFinding({
      ...base,
      issues: [
        issue('NEW', '2026-08-25T00:00:00Z'),
        issue('OLD', '2026-08-01T00:00:00Z'),
        issue('UNDATED', null),
      ],
    });
    expect(out).toMatchObject({
      group: 'errors',
      id: 'a',
      level: 'fail',
      coverage: 'incomplete',
      message:
        '1 unresolved issue first seen in test in the last 14d (Sentry issues for fx-a-test); evidence is incomplete',
    });
    expect(out.evidence).toMatchObject({
      slug: 'fx-a-test',
      issues: [{ short_id: 'NEW', count: 3 }],
    });
  });

  it('reports a floor, not a count, when the tracker said it had more', () => {
    const issues = Array.from({ length: 1000 }, (_, i) => issue(`I${i}`, '2026-08-30T00:00:00Z'));
    expect(errorsFinding({ ...base, issues, capped: true }).message).toMatch(
      /^at least 1000 unresolved issues/,
    );
    expect(errorsFinding({ ...base, issues }).message).toMatch(/^1000 unresolved issues/);
  });

  it('warns about an open issue the tracker cannot date, instead of passing', () => {
    const out = errorsFinding({ ...base, issues: [issue('UNDATED', null)] });
    expect(out).toMatchObject({
      level: 'warn',
      coverage: 'incomplete',
      message: '1 unresolved issue in test undated (Sentry issues for fx-a-test)',
    });
    expect(out.evidence).toMatchObject({ undated: 1, issues: [] });
  });

  it('warns when the tracker had more than it sent and none of what it sent is new', () => {
    const out = errorsFinding({
      ...base,
      issues: [issue('OLD', '2026-08-01T00:00:00Z')],
      capped: true,
    });
    expect(out).toMatchObject({ level: 'warn', coverage: 'incomplete' });
    expect(out.message).toContain('more unresolved issues than fx asked for');
  });

  it('passes when nothing new is open', () => {
    const out = errorsFinding({ ...base, issues: [issue('OLD', '2026-08-01T00:00:00Z')] });
    expect(out).toMatchObject({ level: 'ok', coverage: 'checked' });
    expect(out.evidence).toMatchObject({ issues: [] });
  });
});

it('keeps old activity candidates without presenting scoped firstSeen as a lifetime date', () => {
  const out = errorsFinding({
    ...base,
    issues: [
      issue('OLD', '2026-08-01T00:00:00Z'),
      { ...issue('SCOPED', '2026-09-01T00:00:00Z'), firstSeenScope: 'unknown' },
      issue('END', '2026-09-03T00:00:00Z'),
      issue('FUTURE', '2026-09-04T00:00:00Z'),
    ],
  });
  expect(out).toMatchObject({ level: 'warn', coverage: 'incomplete' });
  expect(out.evidence).toMatchObject({
    issues: [],
    error_evidence: {
      items: [
        { id: 'OLD', lifetime_first_seen: '2026-08-01T00:00:00Z' },
        { id: 'SCOPED', lifetime_first_seen: null, first_seen_scope: 'unknown' },
        { id: 'END' },
        { id: 'FUTURE' },
      ],
    },
  });
});

it('keeps real status observation times separate from report start and sanitizes invalid lifetime evidence', () => {
  const out = errorsFinding({
    ...base,
    issues: [
      {
        ...issue('PRECISE', '2026-08-25T00:00:00.672000Z'),
        statusObservedAt: '2026-09-03T00:07:00.000Z',
      },
      { ...issue('INVALID', 'invalid'), firstSeenScope: 'lifetime' },
    ],
  });
  expect(out.evidence).toMatchObject({
    undated: 1,
    issues: [{ short_id: 'PRECISE' }],
    error_evidence: {
      observed_at: base.now.toISOString(),
      status_scope: 'current',
      status_observed_at: null,
      items: [
        {
          lifetime_first_seen: '2026-08-25T00:00:00.672000Z',
          status_observed_at: '2026-09-03T00:07:00.000Z',
        },
        { lifetime_first_seen: null, first_seen_scope: 'unknown', status_observed_at: null },
      ],
    },
  });
});

it('includes issues observed after report start when they fall inside the explicit release window', () => {
  const out = errorsFinding({
    ...base,
    range: { start: '2026-09-02T00:00:00Z', end: '2026-09-04T00:00:00Z', bounds: '[start,end)' },
    issues: [issue('DURING_SCAN', '2026-09-03T00:04:00Z'), issue('END', '2026-09-04T00:00:00Z')],
  });
  expect(out).toMatchObject({ level: 'fail', coverage: 'checked' });
  expect(out.evidence).toMatchObject({ issues: [{ short_id: 'DURING_SCAN' }] });
});
