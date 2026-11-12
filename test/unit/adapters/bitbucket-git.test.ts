import { describe, expect, it, vi } from 'vitest';

import { BitbucketGitProcess } from '../../../src/adapters/code-host/bitbucket-cli/git-process.js';
import { DevkitError } from '../../../src/domain/errors.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const ok = { code: 0, stdout: '', stderr: '' };

function native(): FakeProcess {
  const process = new FakeProcess();
  process.binaries.add('bitbucket-cli');
  return process.on(['bitbucket-cli', 'git', '--help'], { ...ok, stdout: '--fallback' });
}

describe('native Bitbucket Git authentication', () => {
  it('routes clone and later fetch through the same companion without exposing credentials', async () => {
    const process = native().on(['bitbucket-cli', '--use-context', 'team', 'git'], ok);
    const git = new BitbucketGitProcess(process, { context: 'team' });
    for (const args of [
      ['clone', '--origin', 'upstream', 'ssh://git@git.example.com/TEAM/repo.git', '/work/repo'],
      ['-C', '/work/repo', 'fetch', '--prune', 'upstream'],
      ['-C', '/work/repo', 'ls-remote', '--symref', 'upstream', 'HEAD'],
    ]) {
      expect(await git.run(['git', ...args], { timeoutMs: 2000 })).toEqual(ok);
      expect(
        process.calledWith([
          'bitbucket-cli',
          '--use-context',
          'team',
          'git',
          '--fallback',
          '--',
          ...args,
        ]),
      ).toBe(true);
    }
    expect(process.callsTo(['bitbucket-cli', 'git', '--help'])).toHaveLength(1);
  });

  it('preserves Git failures and cancellation instead of retrying with another identity', async () => {
    const denied = { code: 128, stdout: '', stderr: 'Authentication failed' };
    const process = native().on(['bitbucket-cli', 'git', '--fallback'], denied);
    const signal = new AbortController().signal;
    const git = new BitbucketGitProcess(process);
    expect(await git.run(['git', 'ls-remote', 'upstream'], { signal })).toEqual(denied);
    expect(process.soleCallTo(['bitbucket-cli', 'git', '--fallback']).options.signal).toBe(signal);
    expect(process.callsTo(['git'])).toHaveLength(0);
  });

  it('requires matching public service settings before any authenticated Git request', async () => {
    const check = ['bitbucket-cli', 'config', 'set-context', 'team'];
    const process = native().on(check, { ...ok, stdout: '{"changed":true}' });
    const git = new BitbucketGitProcess(process, {
      context: 'team',
      base_url: 'https://git.example.com',
      flavor: 'datacenter',
    });
    const args = ['git', 'ls-remote', 'ssh://git@git.example.com/TEAM/repo.git'];
    const signal = new AbortController().signal;
    await expect(git.run(args, { signal, timeoutMs: 2000 })).rejects.toMatchObject({
      code: 'LOGIN_REQUIRED',
    });
    expect(process.callsTo(['bitbucket-cli', '--use-context'])).toHaveLength(0);
    expect(process.soleCallTo(check).options.signal).toBe(signal);
    expect(process.soleCallTo(check).options.timeoutMs).toBeLessThanOrEqual(2000);
    process.override(check, { ...ok, stdout: '{"changed":false}' });
    process.on(['bitbucket-cli', '--use-context'], ok);
    expect(await git.run(args)).toEqual(ok);
    expect(
      process.calledWith([
        'bitbucket-cli',
        '--use-context',
        'team',
        '--base-url',
        'https://git.example.com',
        '--flavor',
        'datacenter',
        'git',
        '--fallback',
        '--',
        ...args.slice(1),
      ]),
    ).toBe(true);
  });

  it('shares the invocation deadline and lets a later invocation retry a failed probe', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const process = native()
        .override(['bitbucket-cli', 'git', '--help'], () => {
          now += 120;
          return { ...ok, stdout: '--fallback' };
        })
        .on(['bitbucket-cli', 'git', '--fallback'], (_args, options) => {
          expect(options.timeoutMs).toBe(80);
          throw new DevkitError('internal', 'PROCESS_TIMEOUT', 'Git timed out', { nextSteps: [] });
        });
      await expect(
        new BitbucketGitProcess(process).run(['git', 'fetch', 'upstream'], {
          timeoutMs: 200,
        }),
      ).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' });
      const retry = native().override(
        ['bitbucket-cli', 'git', '--help'],
        new DevkitError('internal', 'PROCESS_TIMEOUT', 'Probe timed out', { nextSteps: [] }),
      );
      const git = new BitbucketGitProcess(retry);
      await expect(git.run(['git', 'fetch', 'upstream'])).rejects.toMatchObject({
        code: 'PROCESS_TIMEOUT',
      });
      retry
        .override(['bitbucket-cli', 'git', '--help'], { ...ok, stdout: '--fallback' })
        .on(['bitbucket-cli', 'git', '--fallback'], ok);
      expect(await git.run(['git', 'fetch', 'upstream'])).toEqual(ok);
    } finally {
      clock.mockRestore();
    }
  });

  it('preserves the companion authentication and permission recovery', async () => {
    const process = native().on(['bitbucket-cli', 'git', '--fallback'], {
      code: 4,
      stdout: '',
      stderr: JSON.stringify({
        error: {
          category: 'auth',
          code: 'HTTP_Unauthorized',
          message: 'Token rejected',
          next_steps: ['bitbucket-cli --use-context team auth login'],
        },
      }),
    });
    await expect(
      new BitbucketGitProcess(process).run(['git', 'fetch', 'upstream']),
    ).rejects.toMatchObject({
      category: 'auth',
      code: 'HTTP_Unauthorized',
      nextSteps: ['bitbucket-cli --use-context team auth login'],
    });
  });

  it('keeps local plumbing and installations without the new companion on ordinary Git', async () => {
    const process = new FakeProcess().on(['git'], ok);
    const git = new BitbucketGitProcess(process);
    await git.run(['git', 'clone', '/local/repo', '/work/repo']);
    await git.run(['git', '-C', '/work/repo', 'status', '--porcelain=v2']);
    expect(process.callsTo(['git'])).toHaveLength(2);
    expect(process.callsTo(['bitbucket-cli'])).toHaveLength(0);
    const old = native()
      .override(['bitbucket-cli', 'git', '--help'], { ...ok, code: 2 })
      .on(['git'], ok);
    expect(await new BitbucketGitProcess(old).run(['git', 'fetch', 'upstream'])).toEqual(ok);
    expect(old.callsTo(['git', 'fetch'])).toHaveLength(1);
    const installed = native().on(['git'], ok);
    for (const source of ['/local/repo', './repo', 'repo', 'file:///local/repo', 'C:\\repo']) {
      expect(
        await new BitbucketGitProcess(installed, { context: 'missing' }).run([
          'git',
          'clone',
          '--origin',
          'upstream',
          '--branch',
          'main',
          source,
          '/work/repo',
        ]),
      ).toEqual(ok);
    }
    expect(installed.callsTo(['bitbucket-cli'])).toHaveLength(0);
  });
});
