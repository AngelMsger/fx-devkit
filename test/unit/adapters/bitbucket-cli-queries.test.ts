import { describe, expect, it } from 'vitest';

import { BitbucketCodeHost } from '../../../src/adapters/code-host/bitbucket-cli/provider.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const ref = { project: 'FX', name: 'fx-example-auth' };
const BB = ['bitbucket-cli', '--format', 'json'];

function host(proc: FakeProcess): BitbucketCodeHost {
  return new BitbucketCodeHost(
    { process: proc, fs: new FakeFs(), clock: new FakeClock() },
    { host: 'ssh://git@git.example.com:12345' },
  );
}

const ok = (data: unknown) => ({ code: 0, stdout: JSON.stringify(data), stderr: '' });
const fail = (code: number, message: string) => ({
  code,
  stdout: '',
  stderr: JSON.stringify({ error: { message } }),
});

describe('BitbucketCodeHost queries', () => {
  it('lists every branch with its head and which one is the default', async () => {
    const proc = new FakeProcess().on(
      [...BB, 'branch', 'list', '--repo', 'FX/fx-example-auth', '--all'],
      ok({
        items: [
          { name: 'dev', last_commit: 'aaa', target: 'aaa', default: true },
          { name: 'main', target: 'bbb', default: false },
        ],
        has_more: false,
      }),
    );
    expect(await host(proc).branches(ref)).toEqual([
      { name: 'dev', sha: 'aaa', default: true },
      { name: 'main', sha: 'bbb', default: false },
    ]);
    expect(proc.calls[0]?.options.timeoutMs).toBe(15_000);
  });

  it('compares two refs and turns the epoch-millisecond date into ISO 8601', async () => {
    const proc = new FakeProcess().on(
      [
        ...BB,
        'commit',
        'compare',
        '--repo',
        'FX/fx-example-auth',
        '--from',
        'main',
        '--to',
        'dev',
        '--all',
      ],
      ok({
        items: [
          {
            hash: 'c1',
            author: 'Alice',
            date: '1788408269000',
            message: 'fix: m-1 thing',
            parents: ['p1'],
          },
        ],
        has_more: false,
      }),
    );
    expect(await host(proc).compare(ref, { from: 'main', to: 'dev' })).toEqual([
      {
        sha: 'c1',
        author: 'Alice',
        date: '2026-09-03T04:04:29.000Z',
        message: 'fix: m-1 thing',
        parents: ['p1'],
      },
    ]);
  });

  it('reads one commit', async () => {
    const proc = new FakeProcess().on(
      [...BB, 'commit', 'get', 'c1', '--repo', 'FX/fx-example-auth'],
      ok({ hash: 'c1', author: 'Bob', date: '0', message: 'init', parents: [] }),
    );
    expect(await host(proc).commit(ref, 'c1')).toMatchObject({
      sha: 'c1',
      author: 'Bob',
      date: '1970-01-01T00:00:00.000Z',
    });
  });

  it('returns a file verbatim, undefined when absent, and throws otherwise', async () => {
    const vector = [
      ...BB,
      'file',
      'get',
      'FX/fx-example-auth',
      '--path',
      'VERSION',
      '--ref',
      'main',
    ];
    const present = new FakeProcess().on(vector, { code: 0, stdout: '1.2.3\n', stderr: '' });
    expect(await host(present).readFile(ref, 'VERSION', 'main')).toBe('1.2.3\n');
    expect(present.calls[0]?.vector.slice(-2)).toEqual(['--output', '-']);

    const absent = new FakeProcess().on(vector, fail(6, 'not there'));
    expect(await host(absent).readFile(ref, 'VERSION', 'main')).toBeUndefined();

    const broken = new FakeProcess().on(vector, fail(9, 'server down'));
    await expect(host(broken).readFile(ref, 'VERSION', 'main')).rejects.toMatchObject({
      code: 'PLATFORM_QUERY_FAILED',
      category: 'server',
    });
  });

  it('turns a refused query into an auth error, never an empty answer', async () => {
    const proc = new FakeProcess().always(fail(4, 'token expired'));
    await expect(host(proc).branches(ref)).rejects.toMatchObject({
      category: 'auth',
      code: 'PLATFORM_AUTH',
    });
  });

  it('refuses a successful answer whose rows it cannot read', async () => {
    const branches = new FakeProcess().always(ok({ items: [{ name: 'dev' }] }));
    await expect(host(branches).branches(ref)).rejects.toMatchObject({
      code: 'PLATFORM_QUERY_FAILED',
    });
    const commits = new FakeProcess().always(ok({ items: [{ hash: 'abc', message: 'no date' }] }));
    await expect(host(commits).compare(ref, { from: 'a', to: 'b' })).rejects.toMatchObject({
      code: 'PLATFORM_QUERY_FAILED',
    });
  });

  it('says when the CLI is not installed at all', async () => {
    await expect(
      host(new FakeProcess()).compare(ref, { from: 'a', to: 'b' }),
    ).rejects.toMatchObject({ code: 'TOOL_MISSING' });
  });
});
