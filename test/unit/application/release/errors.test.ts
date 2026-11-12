// Partial page traversal must remain useful and must never report absent issues.
import { describe, expect, it } from 'vitest';

import { collectIssues } from '../../../../src/application/release/errors.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import type { Issue, IssuePage } from '../../../../src/domain/obs/types.js';
import { errorsFinding } from '../../../../src/domain/release/errors.js';
import { FakeErrorTracker } from '../../../fakes/fake-error-tracker.js';

const query = { since: '14d', limit: 1000 };
const issue = (id: string): Issue => ({
  id,
  shortId: id,
  title: '',
  level: 'error',
  firstSeen: '2026-01-01T00:00:00Z',
  lastSeen: null,
  count: 1,
  url: null,
  culprit: null,
});

function scripted(pages: readonly (IssuePage | Error)[]): FakeErrorTracker {
  const tracker = new FakeErrorTracker();
  let index = 0;
  tracker.issues = async () => {
    const page = pages[index++];
    if (page instanceof Error) throw page;
    if (page === undefined) throw new Error('Unexpected page request');
    return page;
  };
  return tracker;
}

describe('release issue traversal', () => {
  it('reads beyond 1000, deduplicates overlap and accepts an explicit empty last page', async () => {
    const tracker = scripted([
      {
        issues: Array.from({ length: 1000 }, (_, index) => issue(String(index))),
        more: true,
        next: 'p2',
      },
      { issues: [issue('999'), issue('1000')], more: true, next: 'p3' },
      { issues: [], more: false },
    ]);
    const page = await collectIssues(tracker, {}, query);
    expect(page).toMatchObject({ more: false, coverage: 'checked', pagesRead: 3, failures: [] });
    expect(page.issues).toHaveLength(1001);
  });

  it('retains the prior page and retry cursor after a later failure', async () => {
    const tracker = scripted([
      { issues: [issue('1')], more: true, next: 'p2' },
      new DevkitError('rate_limit', 'THROTTLED', 'Try later'),
    ]);
    expect(await collectIssues(tracker, {}, query)).toMatchObject({
      issues: [{ id: '1' }],
      more: true,
      next: 'p2',
      coverage: 'incomplete',
      pagesRead: 1,
      truncationReason: 'page_failed',
      failures: [{ stage: 'list', error: { code: 'THROTTLED', retryable: true } }],
    });
  });

  it.each([
    { more: true, next: undefined, expected: 'continuation_unavailable' },
    { more: true, next: 'p2', expected: 'pagination_no_progress' },
  ])('stops without inventing completion: $expected', async ({ next, expected }) => {
    const tracker = scripted([
      { issues: [issue('1')], more: true, next: 'p2' },
      { issues: [issue('1')], more: true, ...(next === undefined ? {} : { next }) },
    ]);
    expect(await collectIssues(tracker, {}, query)).toMatchObject({
      more: true,
      coverage: 'incomplete',
      truncationReason: expected,
    });
  });

  it('returns a continuation at its safety budget and preserves metadata failures', async () => {
    const tracker = scripted([
      { issues: [issue('1')], more: true, next: 'p2', coverage: 'incomplete' },
    ]);
    expect(await collectIssues(tracker, {}, query, 1)).toMatchObject({
      more: true,
      next: 'p2',
      coverage: 'incomplete',
      truncationReason: 'page_limit',
    });
  });
});

it.each(['resolved', 'ignored'])(
  'uses the final %s observation across overlapping pages without stopping at an advancing cursor',
  async (status) => {
    const original = { ...issue('1'), firstSeen: '2026-09-01T00:00:00Z', status: 'unresolved' };
    const final = { ...original, status, statusObservedAt: '2026-09-03T00:05:00Z' };
    const page = await collectIssues(
      scripted([
        { issues: [original], more: true, next: 'p2' },
        { issues: [final], more: true, next: 'p3' },
        { issues: [], more: false },
      ]),
      {},
      query,
    );
    expect(page).toMatchObject({
      issues: [final],
      more: false,
      pagesRead: 3,
      coverage: 'checked',
      failures: [],
    });
    const finding = errorsFinding({
      repo: 'example',
      env: 'test',
      slug: 'example',
      label: 'Tracker',
      since: '14d',
      now: new Date('2026-09-03T00:00:00Z'),
      issues: page.issues,
      capped: page.more,
      page,
    });
    expect(finding).toMatchObject({
      level: 'ok',
      coverage: 'checked',
      evidence: {
        issues: [],
        error_evidence: {
          deduplication: 'latest_observation',
          items: [{ id: '1', status, status_observed_at: final.statusObservedAt }],
        },
      },
    });
  },
);
