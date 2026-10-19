import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ContributionGitTransport } from '../../../src/adapters/git/contribution-transport.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { git } from '../../git.js';
import { tempDir } from '../../temp.js';

function fixture(): { dir: string; remote: string; commit: string } {
  const dir = tempDir('fx-contribution-transport-');
  const remote = path.join(dir, 'fork.git');
  git(['init', '--bare', '-q', remote], dir);
  git(['init', '-q'], dir);
  git(['config', 'user.name', 'Fixture'], dir);
  git(['config', 'user.email', 'fixture@example.com'], dir);
  writeFileSync(path.join(dir, 'a'), 'a');
  git(['add', '--', 'a'], dir);
  git(['commit', '-qm', 'initial'], dir);
  git(['remote', 'add', 'origin', remote], dir);
  git(['remote', 'add', 'upstream', 'ssh://git@git.example.com/TEAM/manifest.git'], dir);
  return { dir, remote, commit: git(['rev-parse', 'HEAD'], dir) };
}

describe('contribution transport settings', () => {
  it('captures every push URL and detects mirror, receive-pack and rewrite overrides', async () => {
    const f = fixture();
    const adapter = new ContributionGitTransport(new NodeProcess());
    const initial = await adapter.inspect({ dir: f.dir });
    expect(initial.pushUrls).toEqual([f.remote]);
    git(['config', '--add', 'remote.origin.pushurl', f.remote], f.dir);
    git(
      ['config', '--add', 'remote.origin.pushurl', 'ssh://git@git.example.com/OTHER/manifest.git'],
      f.dir,
    );
    git(['config', 'remote.origin.mirror', 'true'], f.dir);
    git(['config', 'remote.origin.receivepack', 'custom'], f.dir);
    git(['config', 'url.ssh://git@git.example.com/.insteadOf', 'alias:'], f.dir);
    const changed = await adapter.inspect({ dir: f.dir });
    expect(changed).toMatchObject({ isMirror: true, hasRewrite: true, receivePack: 'custom' });
    expect(changed.pushUrls).toHaveLength(2);
    expect(changed.fingerprint).not.toBe(initial.fingerprint);
  });
  it('discovers and fetches only the source upstream without moving source HEAD', async () => {
    const f = fixture();
    const upstream = path.join(f.dir, 'upstream.git');
    git(['clone', '--bare', '-q', f.dir, upstream], f.dir);
    git(['remote', 'set-url', 'upstream', upstream], f.dir);
    const adapter = new ContributionGitTransport(new NodeProcess());
    const settings = await adapter.inspect({ dir: f.dir });
    const head = await adapter.upstream({ dir: f.dir });
    expect(head.sha).toBe(f.commit);
    const before = git(['rev-parse', 'HEAD'], f.dir);
    await adapter.fetch({ dir: f.dir, settings, branch: head.branch });
    expect(git(['rev-parse', 'HEAD'], f.dir)).toBe(before);
    expect(git(['rev-parse', `refs/remotes/upstream/${head.branch}`], f.dir)).toBe(f.commit);
  });
  it('pushes only the explicit contribution commit and branch with no tags', async () => {
    const f = fixture();
    const process = new NodeProcess();
    const calls = vi.spyOn(process, 'run');
    const adapter = new ContributionGitTransport(process);
    const settings = await adapter.inspect({ dir: f.dir });
    const remote = {
      url: f.remote,
      fingerprint: settings.fingerprint,
      source: { project: '~fixture', name: 'manifest' },
      target: { project: 'TEAM', name: 'manifest' },
      targetBranch: 'main',
    };
    git(['tag', 'unrelated-tag'], f.dir);
    git(['config', 'push.followTags', 'true'], f.dir);
    await adapter.push({ dir: f.dir, remote, branch: 'fx/contribution/test', commit: f.commit });
    expect(git(['for-each-ref', '--format=%(refname)'], f.remote)).toBe(
      'refs/heads/fx/contribution/test',
    );
    const vector = calls.mock.calls.find(([vector]) => vector.includes('push'))?.[0];
    expect(vector).toContain(`${f.commit}:refs/heads/fx/contribution/test`);
    expect(vector).not.toContain('--force');
    expect(await adapter.head({ dir: f.dir, remote, branch: 'fx/contribution/test' })).toBe(
      f.commit,
    );
    expect(
      await adapter.head({ dir: f.dir, remote, branch: 'fx/contribution/missing' }),
    ).toBeNull();
  });
  it('refuses non-fast-forward pushes and preserves the remote branch', async () => {
    const f = fixture();
    const adapter = new ContributionGitTransport(new NodeProcess());
    const settings = await adapter.inspect({ dir: f.dir });
    const remote = {
      url: f.remote,
      fingerprint: settings.fingerprint,
      source: { project: '~fixture', name: 'manifest' },
      target: { project: 'TEAM', name: 'manifest' },
      targetBranch: 'main',
    };
    const request = { dir: f.dir, remote, branch: 'fx/contribution/test' };
    await adapter.push({ ...request, commit: f.commit });
    git(['commit', '--allow-empty', '-qm', 'next'], f.dir);
    const next = git(['rev-parse', 'HEAD'], f.dir);
    await adapter.push({ ...request, commit: next });
    await expect(adapter.push({ ...request, commit: f.commit })).rejects.toMatchObject({
      code: 'SOURCE_PUSH_REJECTED',
      category: 'conflict',
    });
    expect(await adapter.head(request)).toBe(next);
  });
  it('refuses to push if remote configuration changed after approval', async () => {
    const f = fixture();
    const process = new NodeProcess();
    const calls = vi.spyOn(process, 'run');
    const adapter = new ContributionGitTransport(process);
    const settings = await adapter.inspect({ dir: f.dir });
    git(['config', 'remote.origin.mirror', 'true'], f.dir);
    const remote = {
      url: f.remote,
      fingerprint: settings.fingerprint,
      source: { project: '~fixture', name: 'manifest' },
      target: { project: 'TEAM', name: 'manifest' },
      targetBranch: 'main',
    };
    await expect(
      adapter.push({ dir: f.dir, remote, branch: 'fx/contribution/test', commit: f.commit }),
    ).rejects.toMatchObject({ code: 'SOURCE_REMOTE_CHANGED' });
    expect(calls.mock.calls.some(([vector]) => vector.includes('push'))).toBe(false);
  });
});
