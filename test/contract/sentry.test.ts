// Runs the Sentry query adapter against one readable project; all coordinates
// come from the environment and the query is read-only with a one-row limit.

import { describe, expect, it } from 'vitest';

import { SentryErrorTracker } from '../../src/adapters/error-tracker/sentry/tracker.js';
import { NodeProcess } from '../../src/adapters/process/node-process.js';
import { resolveRange } from '../../src/domain/release/window.js';

const live = process.env['FX_TEST_LIVE'] === '1';
const host = process.env['FX_TEST_SENTRY_HOST'];
const org = process.env['FX_TEST_SENTRY_ORG'];
const project = process.env['FX_TEST_SENTRY_PROJECT'];

describe.skipIf(!live || host === undefined || org === undefined || project === undefined)(
  'sentry (live)',
  () => {
    it('reads an issue page through the real CLI response contract', async () => {
      const tracker = new SentryErrorTracker(new NodeProcess());
      const now = new Date();
      const range = resolveRange({ since: '1h' }, now);
      const page = await tracker.issues(
        { host: host ?? '', org: org ?? '', slug: project ?? '' },
        { since: '1h', limit: 1, range, observedAt: now.toISOString() },
      );

      const finishedAt = new Date();
      expect(typeof page.more).toBe('boolean');
      expect(page.pagesRead).toBe(1);
      if (page.more) expect(typeof page.next).toBe('string');
      expect(page.issues.length).toBeLessThanOrEqual(1);
      for (const issue of page.issues) {
        expect(issue.id.length).toBeGreaterThan(0);
        expect(issue.shortId.length).toBeGreaterThan(0);
        expect(typeof issue.count).toBe('number');
        expect(Date.parse(issue.statusObservedAt ?? '')).toBeGreaterThanOrEqual(now.getTime());
        expect(Date.parse(issue.statusObservedAt ?? '')).toBeLessThanOrEqual(finishedAt.getTime());
        if (page.coverage === 'checked') {
          expect(issue.firstSeenScope).toBe('lifetime');
          expect(issue.status).toBe('unresolved');
        }
      }
    });
  },
);
