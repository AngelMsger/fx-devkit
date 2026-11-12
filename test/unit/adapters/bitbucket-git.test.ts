import { describe, expect, it } from 'vitest';

import { BitbucketGitProcess } from '../../../src/adapters/code-host/bitbucket-cli/git-process.js';
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
    const git = new BitbucketGitProcess(process, ['--use-context', 'team']);
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
  });
});
