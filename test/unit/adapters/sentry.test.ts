import { describe, expect, it } from 'vitest';

import { sentryProvider } from '../../../src/adapters/error-tracker/sentry/provider.js';
import { SentryErrorTracker } from '../../../src/adapters/error-tracker/sentry/tracker.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const vars = { host: 'sentry.example.com', org: 'fx', slug: 'fx-example-auth-test' };
const LIST = ['sentry', 'issue', 'list', 'fx/fx-example-auth-test'];

describe('SentryErrorTracker', () => {
  it('locates through the manifest-free default command and page', () => {
    const tracker = new SentryErrorTracker(new FakeProcess());
    expect(tracker.locate(vars)).toEqual({
      label: 'Sentry issues for fx-example-auth-test',
      command: [
        'sentry',
        'issue',
        'list',
        'fx/fx-example-auth-test',
        '--query',
        'is:unresolved',
        '--json',
      ],
      url: 'https://sentry.example.com/organizations/fx/issues/?project=fx-example-auth-test',
    });
    expect(tracker.probe(vars)).toBeUndefined();
  });

  it('lists unresolved issues inside the window, reading the data array', async () => {
    const proc = new FakeProcess().on(LIST, {
      code: 0,
      stdout: JSON.stringify({
        data: [
          {
            id: '250901',
            shortId: 'FX-EXAMPLE-AUTH-TEST-WZ',
            title: 'Error: X',
            level: 'warning',
            firstSeen: '2026-08-20T04:48:01Z',
            lastSeen: '2026-09-03T04:34:40Z',
            count: '2001',
            permalink: 'https://sentry.example.com/organizations/fx/issues/250901/',
            culprit: 'Factory',
          },
        ],
        hasMore: false,
      }),
      stderr: '',
    });
    const page = await new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 5000 });
    expect(page.more).toBe(false);
    expect(page.issues).toEqual([
      {
        id: '250901',
        shortId: 'FX-EXAMPLE-AUTH-TEST-WZ',
        title: 'Error: X',
        level: 'warning',
        firstSeen: '2026-08-20T04:48:01Z',
        lastSeen: '2026-09-03T04:34:40Z',
        count: 2001,
        url: 'https://sentry.example.com/organizations/fx/issues/250901/',
        culprit: 'Factory',
      },
    ]);
    const vector = proc.calls[0]?.vector ?? [];
    expect(vector).toContain('--json');
    expect(vector.slice(vector.indexOf('--query'), vector.indexOf('--query') + 4)).toEqual([
      '--query',
      'is:unresolved firstSeen:-14d',
      '--period',
      '14d',
    ]);
    expect(vector.slice(vector.indexOf('--limit'), vector.indexOf('--limit') + 2)).toEqual([
      '--limit',
      '1000',
    ]);
    expect(proc.calls[0]?.options.timeoutMs).toBe(30_000);
    expect(proc.calls[0]?.options.env).toEqual({ SENTRY_URL: 'https://sentry.example.com' });
  });

  it('takes the ceiling from the tracker, and refuses a row it cannot read', async () => {
    const more = new FakeProcess().on(LIST, {
      code: 0,
      stdout: JSON.stringify({ data: [], hasMore: true }),
      stderr: '',
    });
    expect(
      (await new SentryErrorTracker(more).issues(vars, { since: '14d', limit: 10 })).more,
    ).toBe(true);
    const malformed = new FakeProcess().on(LIST, {
      code: 0,
      stdout: JSON.stringify({ data: [{ title: 'no id here' }], hasMore: false }),
      stderr: '',
    });
    await expect(
      new SentryErrorTracker(malformed).issues(vars, { since: '14d', limit: 10 }),
    ).rejects.toMatchObject({ code: 'PLATFORM_QUERY_FAILED' });
  });

  it('recognises a rejected token by its range or its message', async () => {
    for (const result of [
      { code: 12, stdout: '', stderr: 'Not authenticated. Run sentry auth login.' },
      {
        code: 30,
        stdout: '',
        stderr: 'Error: Failed to list issues: 401 Unauthorized\n  Invalid token',
      },
    ]) {
      const proc = new FakeProcess().on(LIST, result);
      await expect(
        new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 1000 }),
      ).rejects.toMatchObject({ category: 'auth', code: 'PLATFORM_AUTH' });
    }
  });

  it('reports an unknown project as not found, and a missing binary as such', async () => {
    const proc = new FakeProcess().on(LIST, {
      code: 23,
      stdout: '',
      stderr: "Error: Project 'fx-example-auth-test' not found in organization 'fx'.",
    });
    await expect(
      new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 1000 }),
    ).rejects.toMatchObject({ category: 'not_found', code: 'PLATFORM_QUERY_FAILED' });
    await expect(
      new SentryErrorTracker(new FakeProcess()).issues(vars, { since: '14d', limit: 1000 }),
    ).rejects.toMatchObject({ code: 'TOOL_MISSING' });
  });

  it('is the provider the manifest names by the platform name sentry', () => {
    expect(sentryProvider.id).toBe('sentry');
    expect(sentryProvider.tools).toEqual(['sentry']);
    expect(sentryProvider.recipes[0]?.verify).toEqual({ command: ['auth', 'status'] });
  });
});
