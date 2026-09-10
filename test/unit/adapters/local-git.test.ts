import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LocalGitCodeHost } from '../../../src/adapters/code-host/local-git/provider.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { FakeClock } from '../../fakes/fake-clock.js';

describe('LocalGitCodeHost', () => {
  it('reads, forks idempotently and derives URLs inside its directory', async () => {
    const host = mkdtempSync(path.join(tmpdir(), 'fx-host-'));
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
    expect(first).toEqual({ url: path.join(host, '~alice', 'a.git'), created: true });
    expect(existsSync(path.join(host, '~alice', 'a.git', 'HEAD'))).toBe(true);
    expect(await sut.fork({ project: 'fx', name: 'a' })).toEqual({
      url: first.url,
      created: false,
    });
  });
});
