import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LocalGitCodeHost } from '../../../src/adapters/code-host/local-git/provider.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { repoUrl } from '../../../src/domain/workspace/ref.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeProcess } from '../../fakes/fake-process.js';
import { tempDir } from '../../temp.js';

describe('LocalGitCodeHost', () => {
  it('reads, forks idempotently and derives URLs inside its directory', async () => {
    const host = tempDir('fx-host-');
    mkdirSync(path.join(host, 'fx'));
    execFileSync('git', ['init', '--quiet', '--bare', path.join(host, 'fx', 'a.git')]);
    const sut = new LocalGitCodeHost(
      { process: new NodeProcess(), fs: new NodeFs(), clock: new FakeClock() },
      { host, user: 'alice' },
    );

    expect(await sut.canRead({ project: 'fx', name: 'a' })).toBe('readable');
    expect(await sut.canRead({ project: 'fx', name: 'b' })).toBe('missing');
    expect(await sut.whoami()).toEqual({ user: 'alice' });

    const first = await sut.fork({ project: 'fx', name: 'a' });
    // The manifest's host/owner/name.git rule, which git also accepts on Windows.
    expect(first).toEqual({ url: repoUrl(host, '~alice', 'a'), created: true });
    expect(existsSync(path.join(host, '~alice', 'a.git', 'HEAD'))).toBe(true);
    expect(await sut.fork({ project: 'fx', name: 'a' })).toEqual({
      url: first.url,
      created: false,
    });
  });

  it('asks git in the C locale, so a path missing from a ref is recognised', async () => {
    const proc = new FakeProcess().always({
      code: 128,
      stdout: '',
      stderr: "fatal: path 'VERSION' does not exist in 'main'\n",
    });
    const sut = new LocalGitCodeHost(
      { process: proc, fs: new NodeFs(), clock: new FakeClock() },
      { host: '/host' },
    );
    expect(await sut.readFile({ project: 'fx', name: 'a' }, 'VERSION', 'main')).toBeUndefined();
    expect(proc.soleCallTo(['git']).options.env).toEqual({ LC_ALL: 'C' });
  });
});
