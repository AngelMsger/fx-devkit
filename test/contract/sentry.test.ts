// Runs the Sentry query adapter against one readable project; all coordinates
// come from the environment and the query is read-only with a one-row limit.

import { describe, expect, it } from 'vitest';

import { SentryErrorTracker } from '../../src/adapters/error-tracker/sentry/tracker.js';
import { NodeProcess } from '../../src/adapters/process/node-process.js';

const live = process.env['FX_TEST_LIVE'] === '1';
const host = process.env['FX_TEST_SENTRY_HOST'];
const org = process.env['FX_TEST_SENTRY_ORG'];
const project = process.env['FX_TEST_SENTRY_PROJECT'];

describe.skipIf(!live || host === undefined || org === undefined || project === undefined)(
  'sentry (live)',
  () => {
    it('reads an issue page through the real CLI response contract', async () => {
      const tracker = new SentryErrorTracker(new NodeProcess());
      const page = await tracker.issues(
        { host: host ?? '', org: org ?? '', slug: project ?? '' },
        { since: '1h', limit: 1 },
      );

      expect(typeof page.more).toBe('boolean');
      expect(page.issues.length).toBeLessThanOrEqual(1);
      for (const issue of page.issues) {
        expect(issue.id.length).toBeGreaterThan(0);
        expect(issue.shortId.length).toBeGreaterThan(0);
        expect(typeof issue.count).toBe('number');
      }
    });
  },
);
