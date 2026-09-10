// File-symlink cases require a POSIX host; junction behavior has native Windows coverage.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContributionSystemGit } from '../../../src/adapters/git/contribution-system-git.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import type {
  ConstructContribution,
  ConstructedContribution,
} from '../../../src/ports/contribution-git.js';

const roots: string[] = [];
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
function fixture(): { dir: string; base: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'fx-contribution-git-'));
  roots.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'user.email', 'fixture@example.com');
  writeFileSync(path.join(dir, 'selected.md'), 'base selected');
  writeFileSync(path.join(dir, 'unrelated.md'), 'base unrelated');
  git(dir, 'add', '--', 'selected.md', 'unrelated.md');
  git(dir, 'commit', '-qm', 'initial');
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  writeFileSync(path.join(dir, 'selected.md'), 'selected change');
  writeFileSync(path.join(dir, 'unrelated.md'), 'unrelated staged change');
  git(dir, 'add', '--', 'unrelated.md');
  return { dir, base };
}
async function construct(
  adapter: ContributionSystemGit,
  input: ConstructContribution,
): Promise<ConstructedContribution> {
  const result = await adapter.prepare(input);
  await adapter.publish({
    dir: input.snapshot.dir,
    branch: input.branch,
    commit: result.commit,
    expectedHead: input.expectedHead,
  });
  return result;
}
function state(dir: string): unknown {
  return {
    head: git(dir, 'rev-parse', 'HEAD'),
    index: readFileSync(path.join(dir, '.git/index')),
    status: git(dir, 'status', '--porcelain=v1'),
    selected: readFileSync(path.join(dir, 'selected.md')),
    unrelated: readFileSync(path.join(dir, 'unrelated.md')),
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('source contribution Git isolation', () => {
  it('constructs only selected bytes without changing source HEAD, index or working files', async () => {
    const f = fixture();
    const adapter = new ContributionSystemGit(new NodeProcess());
    const before = state(f.dir);
    const objects = git(f.dir, 'count-objects', '-v');
    const snapshot = await adapter.capture({ ...f, paths: ['selected.md'] });
    expect(git(f.dir, 'count-objects', '-v')).toBe(objects);
    expect(state(f.dir)).toEqual(before);
    expect(snapshot.files.map((file) => file.path)).toEqual(['selected.md']);
    const result = await construct(adapter, {
      snapshot,
      branch: 'fx/contribution/test',
      parent: f.base,
      expectedHead: null,
      message: 'docs: TASK-123 update selected resources',
    });
    expect(state(f.dir)).toEqual(before);
    expect(result.tree).toBe(snapshot.tree);
    expect(git(f.dir, 'show', `${result.commit}:selected.md`)).toBe('selected change');
    expect(git(f.dir, 'show', `${result.commit}:unrelated.md`)).toBe('base unrelated');
    expect(git(f.dir, 'rev-parse', 'refs/heads/fx/contribution/test').trim()).toBe(result.commit);
  });
  it('prepares an inspectable commit without publishing the branch until requested', async () => {
    const f = fixture();
    const adapter = new ContributionSystemGit(new NodeProcess());
    const snapshot = await adapter.capture({ ...f, paths: ['selected.md'] });
    const prepared = await adapter.prepare({
      snapshot,
      branch: 'fx/contribution/test',
      parent: f.base,
      expectedHead: null,
      message: 'test',
    });
    expect(git(f.dir, 'for-each-ref', '--format=%(refname)', 'refs/heads/fx/contribution')).toBe(
      '',
    );
    expect(await adapter.inspect({ dir: f.dir, ref: prepared.commit })).toMatchObject({
      sha: prepared.commit,
      tree: snapshot.tree,
      parents: [f.base],
    });
    const publish = {
      dir: f.dir,
      branch: 'fx/contribution/test',
      commit: prepared.commit,
      expectedHead: null,
    };
    await adapter.publish(publish);
    await adapter.publish(publish);
    expect(git(f.dir, 'rev-parse', 'refs/heads/fx/contribution/test').trim()).toBe(prepared.commit);
  });
  it('refuses changed working bytes after the snapshot was validated', async () => {
    const f = fixture();
    const adapter = new ContributionSystemGit(new NodeProcess());
    const snapshot = await adapter.capture({ ...f, paths: ['selected.md'] });
    writeFileSync(path.join(f.dir, 'selected.md'), 'changed after validation');
    await expect(
      construct(adapter, {
        snapshot,
        branch: 'fx/contribution/test',
        parent: f.base,
        expectedHead: null,
        message: 'docs: TASK-123 update selected resources',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_SNAPSHOT_CHANGED' });
    expect(git(f.dir, 'for-each-ref', '--format=%(refname)', 'refs/heads/fx/contribution')).toBe(
      '',
    );
  });
  it('rejects a default branch target before changing refs', async () => {
    const f = fixture();
    const adapter = new ContributionSystemGit(new NodeProcess());
    const snapshot = await adapter.capture({ ...f, paths: ['selected.md'] });
    await expect(
      construct(adapter, {
        snapshot,
        branch: 'main',
        parent: f.base,
        expectedHead: null,
        message: 'test',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_BRANCH_INVALID' });
  });
  it('preserves a UTF-8 byte order mark in the committed blob', async () => {
    const f = fixture();
    writeFileSync(path.join(f.dir, 'selected.md'), '\ufeffcaptured bytes');
    const adapter = new ContributionSystemGit(new NodeProcess());
    const snapshot = await adapter.capture({ ...f, paths: ['selected.md'] });
    const result = await construct(adapter, {
      snapshot,
      branch: 'fx/contribution/test',
      parent: f.base,
      expectedHead: null,
      message: 'test',
    });
    expect(git(f.dir, 'show', `${result.commit}:selected.md`)).toBe('\ufeffcaptured bytes');
  });
  it('never invokes checkout, reset, merge, stash, rebase or an all-files add', async () => {
    const f = fixture();
    const process = new NodeProcess();
    const calls = vi.spyOn(process, 'run');
    const adapter = new ContributionSystemGit(process);
    const snapshot = await adapter.capture({ ...f, paths: ['selected.md'] });
    await construct(adapter, {
      snapshot,
      branch: 'fx/contribution/test',
      parent: f.base,
      expectedHead: null,
      message: 'test',
    });
    const words = calls.mock.calls.flatMap(([vector]) => vector);
    expect(words).not.toEqual(expect.arrayContaining(['add', '-A']));
    for (const command of ['checkout', 'reset', 'merge', 'stash', 'rebase', 'push'])
      expect(words).not.toContain(command);
  });
  it.skipIf(process.platform === 'win32')(
    'rejects a selected symbolic link without changing its target',
    async () => {
      const f = fixture();
      mkdirSync(path.join(f.dir, 'directory'));
      writeFileSync(path.join(f.dir, 'directory/target'), 'untouched');
      symlinkSync('directory/target', path.join(f.dir, 'link'));
      await expect(
        new ContributionSystemGit(new NodeProcess()).capture({ ...f, paths: ['link'] }),
      ).rejects.toMatchObject({ code: 'SOURCE_ENTRY_UNSUPPORTED' });
      expect(readFileSync(path.join(f.dir, 'directory/target'), 'utf8')).toBe('untouched');
    },
  );
  it('matches Git tree ordering for nested files, Unicode paths and opaque base blobs', async () => {
    const f = fixture();
    mkdirSync(path.join(f.dir, 'a'));
    writeFileSync(path.join(f.dir, 'a/base.bin'), Buffer.from([0, 255, 1]));
    writeFileSync(path.join(f.dir, 'a.txt'), 'base');
    git(f.dir, 'add', '--', 'a/base.bin', 'a.txt');
    git(f.dir, 'commit', '-qm', 'nested baseline');
    f.base = git(f.dir, 'rev-parse', 'HEAD').trim();
    writeFileSync(path.join(f.dir, 'a/中文.md'), 'captured');
    const adapter = new ContributionSystemGit(new NodeProcess());
    const snapshot = await adapter.capture({ ...f, paths: ['a/中文.md'] });
    expect(snapshot.baseFiles['a/base.bin']).toBe('\0');
    const result = await construct(adapter, {
      snapshot,
      branch: 'fx/contribution/test',
      parent: f.base,
      expectedHead: null,
      message: 'test',
    });
    expect(result.tree).toBe(snapshot.tree);
    expect(execFileSync('git', ['-C', f.dir, 'show', `${result.commit}:a/base.bin`])).toEqual(
      Buffer.from([0, 255, 1]),
    );
  });
  it('does not overwrite a contribution ref that changed concurrently', async () => {
    const f = fixture();
    const adapter = new ContributionSystemGit(new NodeProcess());
    const snapshot = await adapter.capture({ ...f, paths: ['selected.md'] });
    git(f.dir, 'branch', 'fx/contribution/test', f.base);
    await expect(
      construct(adapter, {
        snapshot,
        branch: 'fx/contribution/test',
        parent: f.base,
        expectedHead: null,
        message: 'test',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_GIT_FAILED' });
    expect(git(f.dir, 'rev-parse', 'refs/heads/fx/contribution/test').trim()).toBe(f.base);
  });
  it('preserves executable mode and explicit deletions', async () => {
    const f = fixture();
    writeFileSync(path.join(f.dir, 'run.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    git(f.dir, 'add', '--', 'run.sh');
    git(f.dir, 'update-index', '--chmod=+x', '--', 'run.sh');
    rmSync(path.join(f.dir, 'selected.md'));
    const adapter = new ContributionSystemGit(new NodeProcess());
    const snapshot = await adapter.capture({ ...f, paths: ['selected.md', 'run.sh'] });
    const result = await construct(adapter, {
      snapshot,
      branch: 'fx/contribution/test',
      parent: f.base,
      expectedHead: null,
      message: 'test',
    });
    expect(git(f.dir, 'ls-tree', result.commit, '--', 'run.sh').startsWith('100755')).toBe(true);
    expect(git(f.dir, 'ls-tree', result.commit, '--', 'selected.md')).toBe('');
  });
});
