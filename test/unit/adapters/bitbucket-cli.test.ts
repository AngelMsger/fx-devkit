import { describe, expect, it } from 'vitest';

import {
  BitbucketCodeHost,
  bitbucketCliProvider,
} from '../../../src/adapters/code-host/bitbucket-cli/provider.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const ref = { project: 'FX', name: 'fx-example-api' };
const vars = { host: 'ssh://git@git.example.com:12345', web: 'https://git.example.com/' };

function host(proc: FakeProcess, extra: Record<string, string> = {}): BitbucketCodeHost {
  return new BitbucketCodeHost(
    { process: proc, fs: new FakeFs(), clock: new FakeClock() },
    { ...vars, ...extra },
  );
}

const ok = (data: unknown) => ({ code: 0, stdout: JSON.stringify(data), stderr: '' });
const fail = (code: number, error: Record<string, unknown>) => ({
  code,
  stdout: '',
  stderr: JSON.stringify({ error }) + '\n',
});

describe('BitbucketCodeHost', () => {
  it('reads the user name from whoami', async () => {
    const proc = new FakeProcess().on(
      ['bitbucket-cli', '--format', 'json', 'whoami'],
      ok({ name: 'alice', slug: 'alice' }),
    );
    expect(await host(proc).whoami()).toEqual({ user: 'alice' });
  });

  it('turns a signed-out whoami into an auth error with the sign-in steps', async () => {
    const proc = new FakeProcess().always(
      fail(4, { category: 'auth', code: 'HTTP_Unauthorized', message: 'no token' }),
    );
    await expect(host(proc).whoami()).rejects.toMatchObject({
      category: 'auth',
      code: 'CODE_HOST_AUTH',
    });
  });

  it('maps repo get exit codes onto readability and never guesses', async () => {
    const cases: [number, string][] = [
      [0, 'readable'],
      [5, 'forbidden'],
      [6, 'missing'],
      [4, 'unknown'],
      [8, 'unknown'],
    ];
    for (const [code, expected] of cases) {
      const proc = new FakeProcess().on(
        ['bitbucket-cli', '--format', 'json', 'repo', 'get', 'FX/fx-example-api'],
        code === 0 ? ok({ slug: 'fx-example-api' }) : fail(code, { message: 'x' }),
      );
      expect(await host(proc).canRead(ref)).toBe(expected);
    }
  });

  it('adds --use-context only when the binding names a context', async () => {
    const plain = new FakeProcess().always(ok({}));
    await host(plain).canRead(ref);
    expect(plain.soleCallTo(['bitbucket-cli']).vector).toEqual([
      'bitbucket-cli',
      '--format',
      'json',
      'repo',
      'get',
      'FX/fx-example-api',
    ]);
    const scoped = new FakeProcess().always(ok({}));
    await host(scoped, { context: 'dc' }).canRead(ref);
    expect(scoped.soleCallTo(['bitbucket-cli']).vector).toEqual([
      'bitbucket-cli',
      '--format',
      'json',
      '--use-context',
      'dc',
      'repo',
      'get',
      'FX/fx-example-api',
    ]);
  });

  it('forks into the personal project and returns the clone URL', async () => {
    const proc = new FakeProcess().on(
      ['bitbucket-cli', '--format', 'json', 'repo', 'fork'],
      ok({ clone_ssh: 'ssh://git@git.example.com:12345/~alice/fx-example-api.git' }),
    );
    expect(await host(proc).fork(ref)).toEqual({
      url: 'ssh://git@git.example.com:12345/~alice/fx-example-api.git',
      created: true,
    });
  });

  it('treats a 409 on fork as "already there" and reads the existing fork back', async () => {
    const proc = new FakeProcess()
      .on(
        ['bitbucket-cli', '--format', 'json', 'repo', 'fork'],
        fail(11, { category: 'conflict', code: 'HTTP_Conflict', http_status: 409 }),
      )
      .on(['bitbucket-cli', '--format', 'json', 'whoami'], ok({ name: 'alice' }))
      .on(
        ['bitbucket-cli', '--format', 'json', 'repo', 'get', '~alice/fx-example-api'],
        ok({ clone_ssh: 'ssh://git@git.example.com:12345/~alice/fx-example-api.git' }),
      );
    expect(await host(proc).fork(ref)).toEqual({
      url: 'ssh://git@git.example.com:12345/~alice/fx-example-api.git',
      created: false,
    });
  });

  it('reports a missing CLI as a tool problem, not a host problem', async () => {
    await expect(host(new FakeProcess()).whoami()).rejects.toMatchObject({
      category: 'config',
      code: 'TOOL_MISSING',
    });
  });

  it('derives upstream, fork and web URLs from the binding variables', () => {
    const h = host(new FakeProcess());
    expect(h.upstreamUrl(ref)).toBe('ssh://git@git.example.com:12345/FX/fx-example-api.git');
    expect(h.forkUrl('alice', ref)).toBe(
      'ssh://git@git.example.com:12345/~alice/fx-example-api.git',
    );
    expect(h.webUrl(ref)).toBe('https://git.example.com/projects/FX/repos/fx-example-api/browse');
  });

  it('declares its tool and the host variable as required', () => {
    expect(bitbucketCliProvider.tools).toEqual(['bitbucket-cli']);
    expect(bitbucketCliProvider.vars.find((v) => v.name === 'host')?.required).toBe(true);
  });
});
