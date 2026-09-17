import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SystemGit } from '../../../src/adapters/git/system-git.js';
import { FileSource } from '../../../src/adapters/manifest-source/file.js';
import { GitRepoSource } from '../../../src/adapters/manifest-source/git-repo.js';
import { StdinSource } from '../../../src/adapters/manifest-source/stdin.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { TerminalPrompter } from '../../../src/adapters/prompter/terminal.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeGit } from '../../fakes/fake-git.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();

describe('FileSource', () => {
  it('copies every manifest document it finds, from the directory or its manifest/ child', async () => {
    const fs = FakeFs.from({
      '/src/manifest/workspace.yaml': 'schema_version: 1\n',
      '/src/manifest/members.yaml': 'sensitive: true\n',
      '/src/manifest/harness.yaml': 'schema_version: 2\nmcp: []\n',
    });
    await new FileSource('/src', fs).materialize('/ws/new');
    expect(await fs.readText('/ws/new/manifest/workspace.yaml')).toBe('schema_version: 1\n');
    expect(await fs.readText('/ws/new/manifest/members.yaml')).toBe('sensitive: true\n');
    expect(await fs.readText('/ws/new/manifest/harness.yaml')).toBe('schema_version: 2\nmcp: []\n');
    expect(await fs.exists('/ws/new/manifest/environments.yaml')).toBe(false);
    await new FileSource('/src/manifest', fs).materialize('/ws/other');
    expect(await fs.exists('/ws/other/manifest/workspace.yaml')).toBe(true);
  });

  it('imports sibling guides and nested assets even when given the manifest child', async () => {
    const fs = FakeFs.from({
      '/src/manifest/workspace.yaml': 'schema_version: 2\nrepos: []',
      '/src/AGENTS.md': 'Read docs/guide.md',
      '/src/docs/guide.md': 'Team background',
      '/src/skills/review/references/check.md': 'Review guidance',
      '/src/.env': 'personal config',
    });
    await new FileSource('/src/manifest', fs).materialize('/target');
    expect(await fs.readText('/target/AGENTS.md')).toBe('Read docs/guide.md');
    expect(await fs.readText('/target/docs/guide.md')).toBe('Team background');
    expect(await fs.readText('/target/skills/review/references/check.md')).toBe('Review guidance');
    expect(await fs.exists('/target/.env')).toBe(false);
    const writes = fs.writes.length;
    await new FileSource('/src', fs).materialize('/target');
    expect(fs.writes.length).toBe(writes);
  });

  it('does not change existing source content when replacement is declined', async () => {
    const fs = FakeFs.from({
      '/src/workspace.yaml': 'new',
      '/target/manifest/workspace.yaml': 'mine',
    });
    await expect(
      new FileSource('/src', fs, async () => false).materialize('/target'),
    ).rejects.toMatchObject({ code: 'MANIFEST_REPLACE_REQUIRED' });
    expect(await fs.readText('/target/manifest/workspace.yaml')).toBe('mine');
    expect(fs.writes).toEqual([]);
  });

  it('rejects overlapping source and destination before replacing anything', async () => {
    const fs = FakeFs.from({ '/target/docs/manifest/workspace.yaml': 'schema_version: 2' });
    await expect(new FileSource('/target/docs', fs).materialize('/target')).rejects.toMatchObject({
      code: 'MANIFEST_SOURCE_INVALID',
    });
    expect(fs.writes).toEqual([]);
  });

  it('rejects a directory without a workspace.yaml', async () => {
    await expect(
      new FileSource('/nowhere', FakeFs.from({})).materialize('/ws/new'),
    ).rejects.toMatchObject({
      code: 'MANIFEST_SOURCE_INVALID',
    });
  });

  it('removes managed documents that disappeared from the directory source', async () => {
    const fs = FakeFs.from({
      '/src/manifest/workspace.yaml': 'schema_version: 1\n',
      '/src/manifest/environments.yaml': 'schema_version: 1\n',
      '/src/manifest/tools.yaml': 'schema_version: 2\n',
      '/src/manifest/members.yaml': 'sensitive: true\n',
      '/src/manifest/harness.yaml': 'schema_version: 2\nmcp: []\n',
    });
    const source = new FileSource('/src', fs, async (paths) => {
      for (const target of paths) await fs.remove(target);
      return true;
    });
    await source.materialize('/ws/source');
    await fs.remove('/src/manifest/environments.yaml');
    await fs.remove('/src/manifest/tools.yaml');
    await fs.remove('/src/manifest/members.yaml');

    await source.materialize('/ws/source');

    expect(await fs.exists('/ws/source/manifest/workspace.yaml')).toBe(true);
    expect(await fs.exists('/ws/source/manifest/environments.yaml')).toBe(false);
    expect(await fs.exists('/ws/source/manifest/tools.yaml')).toBe(false);
    expect(await fs.exists('/ws/source/manifest/members.yaml')).toBe(false);
  });
});

describe('StdinSource', () => {
  it('writes the text as workspace.yaml', async () => {
    const fs = FakeFs.from({});
    await new StdinSource('schema_version: 1\n', fs).materialize('/ws/new');
    expect(await fs.readText('/ws/new/manifest/workspace.yaml')).toBe('schema_version: 1\n');
  });
});

describe('stdin bundle validation', () => {
  it.each([
    '../outside',
    '/absolute',
    'docs/../outside',
    'docs\\outside',
    'manifest/../../outside',
    '.env',
  ])('rejects unsafe or non-payload path %s before writing', async (name) => {
    const fs = FakeFs.from({});
    const input = JSON.stringify({
      source_version: 1,
      files: { 'manifest/workspace.yaml': 'schema_version: 2', [name]: 'bad' },
    });
    await expect(new StdinSource(input, fs).materialize('/target')).rejects.toMatchObject({
      code: 'MANIFEST_SOURCE_INVALID',
    });
    expect(fs.writes).toEqual([]);
  });
});

describe('GitRepoSource against real git', () => {
  it('clones with upstream as the remote, fast-forwards a clean default branch, and keeps a branch the person is on', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'fx-src-'));
    const bare = path.join(base, 'workspace.git');
    const author = path.join(base, 'author');
    git(['init', '--quiet', '--bare', '-b', 'main', bare], base);
    git(['clone', '-q', bare, author], base);
    mkdirSync(path.join(author, 'manifest'));
    const publish = (version: number, message: string): void => {
      writeFileSync(
        path.join(author, 'manifest', 'workspace.yaml'),
        `schema_version: ${version}\n`,
      );
      git(['add', '.'], author);
      git(['commit', '-q', '-m', message], author);
      git(['push', '-q', '-u', 'origin', 'main'], author);
    };
    publish(1, 'one');

    const process = new NodeProcess();
    const source = new GitRepoSource(bare, process, new SystemGit(process));
    const root = path.join(base, 'home', 'workspaces', 'ws', 'source');
    await source.materialize(root);
    const manifest = (): string =>
      readFileSync(path.join(root, 'manifest', 'workspace.yaml'), 'utf8');
    expect(manifest()).toBe('schema_version: 1\n');
    expect(git(['remote'], root)).toBe('upstream');
    writeFileSync(path.join(root, '.git/info/exclude'), 'scratch.log\n');
    writeFileSync(path.join(root, 'scratch.log'), 'ignored non-payload state');

    publish(2, 'two');
    // An unregistered clone left by failed validation is reusable with the same source.
    await source.materialize(root);
    expect(manifest()).toBe('schema_version: 2\n');

    expect(await source.refresh(root)).toEqual({ result: 'up_to_date' });
    expect(manifest()).toBe('schema_version: 2\n');

    git(['checkout', '-q', '-b', 'skill-x'], root);
    publish(3, 'three');
    expect(await source.refresh(root)).toMatchObject({
      result: 'kept',
      reason: expect.stringContaining('on skill-x, not main'),
    });
    expect(manifest()).toBe('schema_version: 2\n');
    git(['checkout', '-q', 'main'], root);
    expect(manifest()).toBe('schema_version: 3\n');
    expect(await source.refresh(root)).toEqual({ result: 'up_to_date' });
  });

  it('reports an unreachable repository as a network error', async () => {
    const root = path.join(mkdtempSync(path.join(tmpdir(), 'fx-src-')), 'ws');
    const process = new NodeProcess();
    await expect(
      new GitRepoSource('/nonexistent/x.git', process, new SystemGit(process)).materialize(root),
    ).rejects.toMatchObject({
      category: 'network',
      code: 'MANIFEST_CLONE_FAILED',
    });
  });
});

describe('GitRepoSource refresh decisions', () => {
  const dir = '/fake/.fx/workspaces/ws/source';
  const clean = { branch: 'main', dirty: false, untracked: 0, ahead: 0, behind: 0 };
  const source = (fake: FakeGit): GitRepoSource =>
    new GitRepoSource(
      'ssh://git@git.example.com/fx/fx-workspace.git',
      new FakeProcess().on(['git', '-C', dir, 'ls-files'], { code: 0, stdout: '', stderr: '' }),
      fake,
    );

  it('follows the default branch upstream names, and keeps a dirty or diverged tree', async () => {
    const git = new FakeGit().add(dir, {
      state: { ...clean, branch: 'trunk' },
      remoteHeads: { upstream: 'trunk' },
      fastForward: 'updated',
    });
    expect(await source(git).refresh(dir)).toEqual({ result: 'updated' });
    expect(git.calls).toEqual([`fetch ${dir} upstream`, `fast-forward ${dir} upstream/trunk`]);

    const dirty = new FakeGit().add(dir, {
      state: { ...clean, dirty: true },
      fastForward: 'diverged',
    });
    expect(await source(dirty).refresh(dir)).toMatchObject({
      result: 'kept',
      reason: 'uncommitted changes on main',
    });
    expect(dirty.calls).toEqual([`fetch ${dir} upstream`]);

    const diverged = new FakeGit().add(dir, { state: clean, fastForward: 'diverged' });
    expect(await source(diverged).refresh(dir)).toMatchObject({
      result: 'kept',
      reason: 'local commits on main diverge from upstream',
    });
    const elsewhere = new FakeGit().add(dir, {
      state: { ...clean, branch: 'skill-x' },
      fastForward: 'diverged',
    });
    expect(await source(elsewhere).refresh(dir)).toMatchObject({
      result: 'kept',
      reason: 'local commits on main diverge from upstream; its ref was not moved',
    });
  });

  it('preserves the source when ignored payload inspection cannot complete', async () => {
    const git = new FakeGit().add(dir, { state: clean, fastForward: 'updated' });
    const failing = new FakeProcess().on(['git', '-C', dir, 'ls-files'], {
      code: 128,
      stdout: '',
      stderr: 'cannot inspect',
    });
    const guarded = new GitRepoSource('https://git.example.com/team/source.git', failing, git);
    expect(await guarded.refresh(dir)).toMatchObject({
      result: 'kept',
      reason: expect.stringContaining('could not be verified'),
    });
    expect(git.calls).toEqual([`fetch ${dir} upstream`]);
  });

  it('moves only the ref while the person is on another branch, and fails on a fetch that fails', async () => {
    const git = new FakeGit().add(dir, { state: { ...clean, branch: 'skill-x' } });
    expect(await source(git).refresh(dir)).toMatchObject({
      result: 'kept',
      reason: 'on skill-x, not main; only the main ref moved',
    });
    expect(git.calls).toContain(`fast-forward ${dir} upstream/main`);

    const offline = new FakeGit().add(dir, { state: clean });
    offline.fetch = async () => {
      throw new Error('could not resolve host');
    };
    await expect(source(offline).refresh(dir)).rejects.toMatchObject({
      category: 'network',
      code: 'MANIFEST_REFRESH_FAILED',
      message: expect.stringContaining('could not resolve host'),
    });
  });
});

describe('TerminalPrompter', () => {
  it('never waits when there is no person: --no-input or no TTY become INPUT_REQUIRED', async () => {
    const noTty = new TerminalPrompter(false, {
      input: Object.assign(process.stdin, { isTTY: false }),
      output: process.stderr,
    });
    await expect(noTty.confirm('Proceed?')).rejects.toMatchObject({
      category: 'config',
      code: 'INPUT_REQUIRED',
    });
    const noInput = new TerminalPrompter(true);
    await expect(noInput.ask('Name?')).rejects.toMatchObject({ code: 'INPUT_REQUIRED' });
    await expect(noInput.pause('Do the thing')).rejects.toMatchObject({
      code: 'INPUT_REQUIRED',
      hint: expect.stringContaining('manual step'),
    });
  });
});
