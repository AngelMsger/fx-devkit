import { describe, expect, it } from 'vitest';

import { SentryCli } from '../../../src/adapters/error-tracker/sentry/client.js';
import { sentryProvider } from '../../../src/adapters/error-tracker/sentry/provider.js';
import { SentryErrorTracker } from '../../../src/adapters/error-tracker/sentry/tracker.js';
import type { ProcessResult } from '../../../src/ports/process.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const vars = { host: 'sentry.example.com', org: 'fx', slug: 'fx-example-auth-test' };
const LIST = ['sentry', 'api', 'organizations/fx/issues/'];
const DETAIL = ['sentry', 'api', 'issues/250901/'];

describe('SentryErrorTracker', () => {
  it.each([undefined, '', '  ', '{slug}'])(
    'refuses an absent or unresolved project (%s) before querying the organization',
    async (slug) => {
      const proc = new FakeProcess();
      await expect(
        new SentryErrorTracker(proc).issues(
          { host: vars.host, org: vars.org, ...(slug === undefined ? {} : { slug }) },
          { since: '14d', limit: 1000 },
        ),
      ).rejects.toMatchObject({ category: 'config', code: 'SENTRY_PROJECT_REQUIRED' });
      expect(proc.calls).toHaveLength(0);
    },
  );

  it('reports a shared network cause without a project-specific error prefix', async () => {
    const proc = new FakeProcess().on(LIST, {
      code: 30,
      stdout: '',
      stderr:
        'Error: Failed to fetch issues from 1 project(s): Network error Unable to reach Sentry at https://sentry.example.com: Connect Timeout Error',
    });
    await expect(
      new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 1000 }),
    ).rejects.toMatchObject({
      category: 'network',
      retryable: true,
      message:
        'sentry: Network error Unable to reach Sentry at https://sentry.example.com: Connect Timeout Error',
    });
  });
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
        status: 200,
        body: [
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
      }),
      stderr: '',
    });
    proc.on(DETAIL, {
      code: 0,
      stdout: JSON.stringify({
        status: 200,
        body: { id: '250901', firstSeen: '2026-07-01T00:00:00Z', status: 'unresolved' },
      }),
      stderr: '',
    });
    const page = await new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 5000 });
    expect(page.more).toBe(false);
    expect(page.issues).toMatchObject([
      {
        id: '250901',
        shortId: 'FX-EXAMPLE-AUTH-TEST-WZ',
        title: 'Error: X',
        level: 'warning',
        firstSeen: '2026-07-01T00:00:00Z',
        firstSeenScope: 'lifetime',
        listFirstSeen: '2026-08-20T04:48:01Z',
        lastSeen: '2026-09-03T04:34:40Z',
        count: 2001,
        url: 'https://sentry.example.com/organizations/fx/issues/250901/',
        culprit: 'Factory',
      },
    ]);
    const vector = proc.soleCallTo(LIST).vector;
    expect(vector).toContain('--json');
    expect(vector).toContain('query=project:"fx-example-auth-test" is:unresolved');
    expect(vector).toContain('statsPeriod=14d');
    expect(vector).toContain('limit=100');
    expect(proc.callsTo(['sentry', 'issue', 'view'])).toHaveLength(0);
    expect(proc.soleCallTo(LIST).options.timeoutMs).toBe(60_000);
    expect(proc.soleCallTo(DETAIL).options.timeoutMs).toBe(30_000);
    expect(proc.soleCallTo(LIST).options.env).toEqual({
      SENTRY_NO_CACHE: '1',
      SENTRY_URL: 'https://sentry.example.com',
      SENTRY_HOST: 'https://sentry.example.com',
    });
    expect(proc.soleCallTo(DETAIL).options.env).toEqual(proc.soleCallTo(LIST).options.env);
  });

  it('takes the ceiling from the tracker, and refuses a row it cannot read', async () => {
    const more = new FakeProcess().on(LIST, {
      code: 0,
      stdout: JSON.stringify({ status: 200, body: [], pagination: { nextCursor: 'p2' } }),
      stderr: '',
    });
    expect(
      (await new SentryErrorTracker(more).issues(vars, { since: '14d', limit: 10 })).more,
    ).toBe(true);
    const malformed = new FakeProcess().on(LIST, {
      code: 0,
      stdout: JSON.stringify({ status: 200, body: [{ title: 'no id here' }] }),
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

  it('reports a CLI that started and exited 127 as a failed query, not as missing', async () => {
    const proc = new FakeProcess().on(LIST, {
      code: 127,
      stdout: '',
      stderr: 'helper executable unavailable\n',
    });
    await expect(
      new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 1000 }),
    ).rejects.toMatchObject({ category: 'server', code: 'PLATFORM_QUERY_FAILED' });
  });

  it('uses absolute bounds and opaque cursors while keeping unknown global dates incomplete', async () => {
    const proc = new FakeProcess()
      .on(LIST, {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          status: 200,
          body: [
            { id: '250901', firstSeen: '2026-09-01T00:00:00Z', status: 'unresolved' },
            { id: '250901', firstSeen: '2026-09-01T00:00:00Z', status: 'unresolved' },
          ],
          pagination: { nextCursor: 'opaque:2' },
        }),
      })
      .on(DETAIL, { code: 30, stdout: '', stderr: '503 Service unavailable' });
    const range = {
      start: '2026-08-20T00:00:00.000Z',
      end: '2026-09-03T00:00:00.000Z',
      bounds: '[start,end)' as const,
    };
    const clock = new FakeClock(new Date('2026-09-03T00:02:00Z'));
    const page = await new SentryErrorTracker(proc, clock).issues(vars, {
      since: '14d',
      limit: 100,
      range,
      cursor: 'opaque:1',
      observedAt: range.end,
    });
    expect(page).toMatchObject({
      more: true,
      next: 'opaque:2',
      coverage: 'incomplete',
      issues: [
        {
          id: '250901',
          firstSeen: null,
          firstSeenScope: 'unknown',
          statusObservedAt: clock.now().toISOString(),
        },
      ],
      failures: [{ stage: 'detail', issue_id: '250901', error: { code: 'PLATFORM_QUERY_FAILED' } }],
    });
    const vector = proc.soleCallTo(LIST).vector;
    expect(vector).toContain(`start=${range.start}`);
    expect(vector).toContain(`end=${range.end}`);
    expect(vector).toContain('opaque:1');
    expect(vector.some((part) => part.startsWith('statsPeriod='))).toBe(false);
    expect(proc.callsTo(DETAIL)).toHaveLength(1);
  });

  it('retains resolved observations for cross-page reconciliation and rejects unsupported envelopes', async () => {
    const proc = new FakeProcess()
      .on(LIST, {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({ status: 200, body: [{ id: '250901', status: 'unresolved' }] }),
      })
      .on(DETAIL, {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          status: 200,
          body: { id: '250901', status: 'resolved', firstSeen: '2026-08-01T00:00:00Z' },
        }),
      });
    expect(
      (await new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 100 })).issues,
    ).toMatchObject([{ id: '250901', status: 'resolved' }]);
    proc.override(LIST, {
      code: 0,
      stderr: '',
      stdout: JSON.stringify({ data: [], hasMore: false }),
    });
    await expect(
      new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 100 }),
    ).rejects.toMatchObject({ code: 'PLATFORM_QUERY_FAILED' });
  });

  it('rejects malformed continuation metadata instead of calling it complete', async () => {
    const proc = new FakeProcess().on(LIST, {
      code: 0,
      stderr: '',
      stdout: JSON.stringify({
        status: 200,
        body: [],
        pagination: { nextCursor: 42 },
      }),
    });
    await expect(
      new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 100 }),
    ).rejects.toMatchObject({ code: 'PLATFORM_QUERY_FAILED' });
  });

  it('marks undated detail metadata incomplete and preserves rate-limit recovery', async () => {
    const proc = new FakeProcess()
      .on(LIST, {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          status: 200,
          body: [{ id: '250901', status: 'unresolved', firstSeen: '2026-09-01T00:00:00Z' }],
        }),
      })
      .on(DETAIL, {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          status: 200,
          body: { id: '250901', status: 'unresolved', firstSeen: null },
        }),
      });
    expect(
      await new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 100 }),
    ).toMatchObject({
      more: false,
      coverage: 'incomplete',
      issues: [{ firstSeen: null }],
      failures: [{ error: { code: 'ISSUE_FIRST_SEEN_UNKNOWN' } }],
    });
    proc.override(LIST, { code: 30, stdout: '', stderr: 'HTTP 429 Too many requests' });
    await expect(
      new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 100 }),
    ).rejects.toMatchObject({ category: 'rate_limit', retryable: true });
  });

  it('dates each successful detail response using its actual observation time', async () => {
    const observedAt = '2026-09-03T00:00:00.000Z';
    const clock = new FakeClock(new Date(observedAt));
    const proc = new FakeProcess()
      .on(LIST, () => {
        clock.advance(60_000);
        return {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            status: 200,
            body: [
              { id: '1', firstSeen: '2026-09-01T00:00:00Z', status: 'unresolved' },
              { id: '2', firstSeen: '2026-09-01T00:00:00Z', status: 'unresolved' },
            ],
          }),
        };
      })
      .when(
        (vector) => vector[2]?.startsWith('issues/') === true,
        (vector) => {
          clock.advance(180_000);
          const id = vector[2]?.split('/')[1];
          return {
            code: 0,
            stderr: '',
            stdout: JSON.stringify({
              status: 200,
              body: {
                id,
                firstSeen: '2026-04-24T07:29:20.672000Z',
                status: 'unresolved',
              },
            }),
          };
        },
      );
    const page = await new SentryErrorTracker(proc, clock).issues(vars, {
      since: '14d',
      limit: 100,
      observedAt,
    });
    expect(page.coverage).toBe('checked');
    expect(page.issues).toMatchObject([
      {
        id: '1',
        firstSeen: '2026-04-24T07:29:20.672000Z',
        firstSeenScope: 'lifetime',
        statusObservedAt: '2026-09-03T00:07:00.000Z',
      },
      {
        id: '2',
        firstSeen: '2026-04-24T07:29:20.672000Z',
        firstSeenScope: 'lifetime',
        statusObservedAt: '2026-09-03T00:07:00.000Z',
      },
    ]);
  });

  it.each([null, 'invalid', '2026-02-30T00:00:00.123456Z'])(
    'keeps an invalid lifetime timestamp unknown: %j',
    async (firstSeen) => {
      const proc = new FakeProcess()
        .on(LIST, {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            status: 200,
            body: [{ id: '250901', firstSeen: '2026-09-01T00:00:00Z', status: 'unresolved' }],
          }),
        })
        .on(DETAIL, {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            status: 200,
            body: {
              id: '250901',
              firstSeen,
              status: 'unresolved',
            },
          }),
        });
      expect(
        await new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 100 }),
      ).toMatchObject({
        coverage: 'incomplete',
        issues: [
          { firstSeen: null, firstSeenScope: 'unknown', listFirstSeen: '2026-09-01T00:00:00Z' },
        ],
        failures: [{ stage: 'detail', error: { code: 'ISSUE_FIRST_SEEN_UNKNOWN' } }],
      });
    },
  );

  it('bounds detail concurrency, replenishes workers and preserves ordered issues and failures', async () => {
    const clock = new FakeClock(new Date('2026-09-03T00:00:00Z'));
    const started = Array.from({ length: 7 }, () => deferred<void>());
    const pending = new Map<string, (result: ProcessResult) => void>();
    let active = 0;
    let maximumActive = 0;
    const proc = new FakeProcess()
      .on(LIST, {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          status: 200,
          body: Array.from({ length: 7 }, (_, index) => ({
            id: String(index + 1),
            status: 'unresolved',
          })),
        }),
      })
      .when(
        (vector) => vector[2]?.startsWith('issues/') === true,
        (vector) => {
          const id = vector[2]?.split('/')[1] ?? '';
          active++;
          maximumActive = Math.max(maximumActive, active);
          const result = new Promise<ProcessResult>((resolve) => pending.set(id, resolve));
          started[pending.size - 1]?.resolve(undefined);
          return result.finally(() => active--);
        },
      );
    const release = (id: string, fails = false): void => {
      clock.advance(60_000);
      const result = fails
        ? { code: 30, stderr: 'HTTP 503 unavailable', stdout: '' }
        : {
            code: 0,
            stderr: '',
            stdout: JSON.stringify({
              status: 200,
              body: { id, status: 'unresolved', firstSeen: '2026-04-24T07:29:20.672000Z' },
            }),
          };
      pending.get(id)?.(result);
    };
    const result = new SentryErrorTracker(proc, clock).issues(vars, { since: '14d', limit: 100 });
    await started[3]?.promise;
    expect(active).toBe(4);
    expect(pending.size).toBe(4);
    release('4');
    await started[4]?.promise;
    release('3', true);
    await started[5]?.promise;
    release('2', true);
    await started[6]?.promise;
    for (const id of ['5', '6', '7', '1']) release(id);
    const page = await result;
    expect(maximumActive).toBe(4);
    expect(active).toBe(0);
    expect(proc.calls.length).toBe(8);
    expect(page.issues.map((issue) => issue.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(page.failures?.map((failure) => failure.issue_id)).toEqual(['2', '3']);
    expect(page.coverage).toBe('incomplete');
    expect(page.issues[3]?.statusObservedAt).toBe('2026-09-03T00:01:00.000Z');
    expect(page.issues[0]?.statusObservedAt).toBe('2026-09-03T00:07:00.000Z');
    expect(page.issues[1]?.firstSeenScope).toBe('unknown');
  });

  it.each([vars.slug, ''])(
    'uses a numeric project ID with slug %j and preserves the range',
    async (slug) => {
      const proc = new FakeProcess().on(LIST, {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({ status: 200, body: [] }),
      });
      const range = {
        start: '2026-08-20T00:00:00.000Z',
        end: '2026-09-03T00:00:00.000Z',
        bounds: '[start,end)' as const,
      };
      await new SentryErrorTracker(proc).issues(
        { ...vars, slug, id: '123' },
        { since: '14d', limit: 100, range },
      );
      const call = proc.soleCallTo(LIST);
      expect(call.vector).toContain('project=123');
      expect(call.vector).toContain('query=is:unresolved');
      expect(call.vector).toContain(`start=${range.start}`);
      expect(call.vector).toContain(`end=${range.end}`);
      expect(call.vector.some((part) => part.startsWith('query=project:'))).toBe(false);
      expect(call.options.timeoutMs).toBe(60_000);
    },
  );

  it.each(['0', '-1', '123,456', 'not-an-id'])(
    'falls back to the exact slug for invalid numeric project ID %s',
    async (id) => {
      const proc = new FakeProcess().on(LIST, {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({ status: 200, body: [] }),
      });
      await new SentryErrorTracker(proc).issues({ ...vars, id }, { since: '14d', limit: 100 });
      const vector = proc.soleCallTo(LIST).vector;
      expect(vector).toContain('query=project:"fx-example-auth-test" is:unresolved');
      expect(vector.some((part) => part.startsWith('project='))).toBe(false);
    },
  );

  it('accepts an exact full terminal page under the companion contract that omits unavailable navigation', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1),
      status: 'unresolved',
      firstSeen: '2026-08-01T00:00:00Z',
    }));
    const proc = new FakeProcess()
      .on(LIST, { code: 0, stderr: '', stdout: JSON.stringify({ status: 200, body: rows }) })
      .when(
        (vector) => vector[2]?.startsWith('issues/') === true,
        (vector) => ({
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            status: 200,
            body: rows.find((row) => vector[2] === `issues/${row.id}/`),
          }),
        }),
      );
    const page = await new SentryErrorTracker(proc).issues(vars, { since: '14d', limit: 100 });
    expect(page).toMatchObject({ more: false, coverage: 'checked', failures: [] });
    expect(page.issues).toHaveLength(100);
    expect(page.next).toBeUndefined();
  });

  it('bypasses response caching even when the companion chooses its configured host', async () => {
    const proc = new FakeProcess().on(DETAIL, {
      code: 0,
      stderr: '',
      stdout: JSON.stringify({ status: 200, body: { id: '250901' } }),
    });
    await new SentryCli(proc).call(['api', 'issues/250901/', '--fields', 'id'], 30_000);
    expect(proc.soleCallTo(DETAIL).options.env).toEqual({ SENTRY_NO_CACHE: '1' });
  });

  it('is the provider the manifest names by the platform name sentry', () => {
    expect(sentryProvider.id).toBe('sentry');
    expect(sentryProvider.tools).toEqual(['sentry']);
    expect(sentryProvider.recipes[0]?.verify).toEqual({ command: ['auth', 'status'] });
  });
});

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred is not initialized');
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

it('binds the actual Sentry project across repository aliases without merging other server or project scopes', () => {
  const tracker = new SentryErrorTracker(new FakeProcess());
  const base = {
    host: 'sentry.example.com',
    org: 'example',
    id: '123',
    slug: 'shared',
    repo: 'a',
    svc: 'a',
    env: 'test',
  };
  const fingerprint = tracker.queryFingerprint(base);
  expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(tracker.queryFingerprint({ ...base, repo: 'b', svc: 'b' })).toBe(fingerprint);
  for (const change of [{ host: 'other.example.com' }, { org: 'other' }, { id: '124' }])
    expect(tracker.queryFingerprint({ ...base, ...change })).not.toBe(fingerprint);
  expect(tracker.queryFingerprint({ org: 'example', slug: 'shared' })).toBeNull();
});
