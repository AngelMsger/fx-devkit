import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContributionGitTransport } from '../../../src/adapters/git/contribution-transport.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';

const roots: string[] = [];
function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}
function fixture(): { dir: string; remote: string; commit: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'fx-contribution-transport-'));
  roots.push(dir);
  const remote = path.join(dir, 'fork.git');
  git(dir, 'init', '--bare', '-q', remote);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'user.email', 'fixture@example.com');
  writeFileSync(path.join(dir, 'a'), 'a');
  git(dir, 'add', '--', 'a');
  git(dir, 'commit', '-qm', 'initial');
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'remote', 'add', 'upstream', 'ssh://git@git.example.com/TEAM/manifest.git');
  return { dir, remote, commit: git(dir, 'rev-parse', 'HEAD').trim() };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('contribution transport settings', () => {
  it('captures every push URL and detects mirror, receive-pack and rewrite overrides', async () => {
    const f = fixture();
    const adapter = new ContributionGitTransport(new NodeProcess());
    const initial = await adapter.inspect({ dir: f.dir });
    expect(initial.pushUrls).toEqual([f.remote]);
    git(f.dir, 'config', '--add', 'remote.origin.pushurl', f.remote);
    git(
      f.dir,
      'config',
      '--add',
      'remote.origin.pushurl',
      'ssh://git@git.example.com/OTHER/manifest.git',
    );
    git(f.dir, 'config', 'remote.origin.mirror', 'true');
    git(f.dir, 'config', 'remote.origin.receivepack', 'custom');
    git(f.dir, 'config', 'url.ssh://git@git.example.com/.insteadOf', 'alias:');
    const changed = await adapter.inspect({ dir: f.dir });
    expect(changed).toMatchObject({ isMirror: true, hasRewrite: true, receivePack: 'custom' });
    expect(changed.pushUrls).toHaveLength(2);
    expect(changed.fingerprint).not.toBe(initial.fingerprint);
  });
  it('discovers and fetches only the source upstream without moving source HEAD', async () => {
    const f = fixture();
    const upstream = path.join(f.dir, 'upstream.git');
    git(f.dir, 'clone', '--bare', '-q', f.dir, upstream);
    git(f.dir, 'remote', 'set-url', 'upstream', upstream);
    const adapter = new ContributionGitTransport(new NodeProcess());
    const settings = await adapter.inspect({ dir: f.dir });
    const head = await adapter.upstream({ dir: f.dir });
    expect(head.sha).toBe(f.commit);
    const before = git(f.dir, 'rev-parse', 'HEAD');
    await adapter.fetch({ dir: f.dir, settings, branch: head.branch });
    expect(git(f.dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(f.dir, 'rev-parse', `refs/remotes/upstream/${head.branch}`).trim()).toBe(f.commit);
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
    git(f.dir, 'tag', 'unrelated-tag');
    git(f.dir, 'config', 'push.followTags', 'true');
    await adapter.push({ dir: f.dir, remote, branch: 'fx/contribution/test', commit: f.commit });
    expect(git(f.remote, 'for-each-ref', '--format=%(refname)')).toBe(
      'refs/heads/fx/contribution/test\n',
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
    git(f.dir, 'commit', '--allow-empty', '-qm', 'next');
    const next = git(f.dir, 'rev-parse', 'HEAD').trim();
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
    git(f.dir, 'config', 'remote.origin.mirror', 'true');
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
