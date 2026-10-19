import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SystemGit } from '../../../src/adapters/git/system-git.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { FakeProcess } from '../../fakes/fake-process.js';
import { tempDir } from '../../temp.js';

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

// A bare upstream with one commit on `dev`, plus a scratch clone to push from.
function upstream(): { bare: string; work: string } {
  const root = tempDir('fx-git-');
  const bare = path.join(root, 'a.git');
  const work = path.join(root, 'work');
  git(['init', '--bare', '-b', 'dev', bare], root);
  git(['clone', '-q', bare, work], root);
  git(['checkout', '-q', '-b', 'dev'], work);
  writeFileSync(path.join(work, 'README'), 'one\n');
  git(['add', '.'], work);
  git(['commit', '-q', '-m', 'one'], work);
  git(['push', '-q', '-u', 'origin', 'dev'], work);
  return { bare, work };
}

function advance(work: string, name: string): void {
  writeFileSync(path.join(work, name), `${name}\n`);
  git(['add', '.'], work);
  git(['commit', '-q', '-m', name], work);
  git(['push', '-q', 'origin', 'dev'], work);
}

describe('SystemGit command vectors', () => {
  it.each([
    ["fatal: couldn't find remote ref gone", 'not_found'],
    ['Permission denied (publickey).', 'auth'],
    ['fatal: Could not resolve host: example.com', 'network'],
    ['fatal: Unable to create index.lock: File exists', 'conflict'],
  ])('does not classify failed fast-forward as divergence: %s', async (stderr, category) => {
    const proc = new FakeProcess();
    proc.when((vector) => !vector.includes('merge'), {
      code: 0,
      stdout: '# branch.head main\n',
      stderr: '',
    });
    proc.when((vector) => vector.includes('merge'), { code: 1, stdout: '', stderr });
    await expect(
      new SystemGit(proc).fastForward('/work/repo', 'upstream', 'main'),
    ).rejects.toMatchObject({ code: 'GIT_FAST_FORWARD_FAILED', category });
  });
  it('retains divergence as a non-destructive outcome', async () => {
    const proc = new FakeProcess();
    proc.when((vector) => !vector.includes('merge'), {
      code: 0,
      stdout: '# branch.head main\n',
      stderr: '',
    });
    proc.when((vector) => vector.includes('merge'), {
      code: 128,
      stdout: '',
      stderr: 'fatal: Not possible to fast-forward, aborting.',
    });
    expect(await new SystemGit(proc).fastForward('/work/repo', 'upstream', 'main')).toBe(
      'diverged',
    );
  });
  it('tells a git that could not start from one that exited 127 itself', async () => {
    const request = { dir: '/work/repo', upstream: 'ssh://u/x.git', branch: 'dev' };
    await expect(new SystemGit(new FakeProcess()).clone(request)).rejects.toMatchObject({
      code: 'TOOL_MISSING',
      message: 'git is not installed or not on PATH',
      nextSteps: ['fx can git'],
    });
    const started = new FakeProcess().always({
      code: 127,
      stdout: '',
      stderr: 'git-remote-https: helper executable unavailable\n',
    });
    await expect(new SystemGit(started).clone(request)).rejects.toMatchObject({
      code: 'GIT_CLONE_FAILED',
      message: expect.stringContaining('helper executable unavailable'),
    });
  });
  it('preserves clone branch and destination in recovery commands', async () => {
    const proc = new FakeProcess();
    proc.always({
      code: 128,
      stdout: '',
      stderr: 'fatal: Remote branch absent not found in upstream origin',
    });
    await expect(
      new SystemGit(proc).clone({
        dir: '/work/a space',
        upstream: 'https://git.example.com/team/repo.git',
        branch: 'absent',
      }),
    ).rejects.toMatchObject({
      category: 'not_found',
      nextSteps: expect.arrayContaining([expect.stringContaining('--branch absent')]),
    });
  });
  it('clones with upstream as the primary remote and adds origin separately', async () => {
    const proc = new FakeProcess();
    proc.always({ code: 0, stdout: '', stderr: '' });
    await new SystemGit(proc).clone({
      dir: '/w/x',
      upstream: 'ssh://u/x.git',
      origin: 'ssh://o/x.git',
      branch: 'dev',
    });
    expect(proc.vectors(), 'clone before the origin remote, in this order').toEqual([
      [
        'git',
        'clone',
        '--quiet',
        '--origin',
        'upstream',
        '--branch',
        'dev',
        'ssh://u/x.git',
        '/w/x',
      ],
      ['git', '-C', '/w/x', 'remote', 'add', 'origin', 'ssh://o/x.git'],
    ]);
  });

  it('never issues checkout, reset, stash, rebase or a non-ff merge', async () => {
    const proc = new FakeProcess();
    proc.always({ code: 0, stdout: '# branch.head dev\n', stderr: '' });
    const sut = new SystemGit(proc);
    await sut.fetch('/w/x', 'upstream');
    await sut.fastForward('/w/x', 'upstream', 'dev');
    await sut.status('/w/x');
    const flat = proc.vectors().map((vector) => vector.join(' '));
    for (const forbidden of ['checkout', 'reset', 'stash', 'rebase', 'pull']) {
      expect(flat.some((v) => v.includes(` ${forbidden}`))).toBe(false);
    }
    expect(flat.some((v) => v.includes('merge --ff-only --quiet upstream/dev'))).toBe(true);
  });
});

describe('SystemGit against real git', () => {
  const sut = new SystemGit(new NodeProcess());

  it('clones with both remotes and reports a clean tracked checkout', async () => {
    const { bare } = upstream();
    const dir = path.join(tempDir('fx-ws-'), 'a');
    await sut.clone({ dir, upstream: bare, origin: `${bare}-fork`, branch: 'dev' });
    expect(await sut.remotes(dir)).toEqual({ upstream: bare, origin: `${bare}-fork` });
    expect(await sut.status(dir, 'upstream/dev')).toEqual({
      branch: 'dev',
      dirty: false,
      untracked: 0,
      ahead: 0,
      behind: 0,
    });
    expect(await sut.toplevel(dir)).toBe(realpathSync.native(dir));
    expect(await sut.toplevel(tmpdir())).toBeUndefined();
  });

  it('tells the top of a checkout from a directory inside it, through a link as well', async () => {
    const { work } = upstream();
    mkdirSync(path.join(work, 'docs'));
    const alias = path.join(tempDir('fx-alias-'), 'work');
    symlinkSync(work, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await sut.isToplevel(work)).toBe(true);
    expect(await sut.isToplevel(alias)).toBe(true);
    expect(await sut.isToplevel(path.join(work, 'docs'))).toBe(false);
    expect(await sut.isToplevel(tmpdir())).toBe(false);
  });

  it('distinguishes dirty tracked changes from untracked files', async () => {
    const { bare } = upstream();
    const dir = path.join(tempDir('fx-ws-'), 'a');
    await sut.clone({ dir, upstream: bare, branch: 'dev' });
    writeFileSync(path.join(dir, 'new.txt'), 'x');
    expect(await sut.status(dir)).toMatchObject({ dirty: false, untracked: 1 });
    writeFileSync(path.join(dir, 'README'), 'changed');
    expect(await sut.status(dir)).toMatchObject({ dirty: true });
  });

  it('fast-forwards a clean checkout on the tracked branch', async () => {
    const { bare, work } = upstream();
    const dir = path.join(tempDir('fx-ws-'), 'a');
    await sut.clone({ dir, upstream: bare, branch: 'dev' });
    expect(await sut.fastForward(dir, 'upstream', 'dev')).toBe('up_to_date');
    advance(work, 'two');
    await sut.fetch(dir, 'upstream');
    expect(await sut.status(dir, 'upstream/dev')).toMatchObject({ behind: 1 });
    expect(await sut.fastForward(dir, 'upstream', 'dev')).toBe('updated');
    expect(git(['log', '--oneline'], dir).split('\n')).toHaveLength(2);
  });

  it('moves only the branch ref when the checkout sits on another branch', async () => {
    const { bare, work } = upstream();
    const dir = path.join(tempDir('fx-ws-'), 'a');
    await sut.clone({ dir, upstream: bare, branch: 'dev' });
    git(['checkout', '-q', '-b', 'feature/x'], dir);
    writeFileSync(path.join(dir, 'wip'), 'wip');
    advance(work, 'two');
    await sut.fetch(dir, 'upstream');
    expect(await sut.fastForward(dir, 'upstream', 'dev')).toBe('updated');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).toBe('feature/x');
    expect(git(['rev-parse', 'dev'], dir)).toBe(git(['rev-parse', 'upstream/dev'], dir));
    expect(git(['status', '--porcelain'], dir)).toContain('wip');
  });

  it('reports a diverged branch and changes nothing', async () => {
    const { bare, work } = upstream();
    const dir = path.join(tempDir('fx-ws-'), 'a');
    await sut.clone({ dir, upstream: bare, branch: 'dev' });
    writeFileSync(path.join(dir, 'local'), 'local');
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', 'local'], dir);
    advance(work, 'remote');
    await sut.fetch(dir, 'upstream');
    const before = git(['rev-parse', 'HEAD'], dir);
    expect(await sut.status(dir, 'upstream/dev')).toMatchObject({ ahead: 1, behind: 1 });
    expect(await sut.fastForward(dir, 'upstream', 'dev')).toBe('diverged');
    expect(git(['rev-parse', 'HEAD'], dir)).toBe(before);
  });

  it('classifies an absent local clone source as not found', async () => {
    const dir = path.join(tempDir('fx-ws-'), 'a');
    await expect(
      sut.clone({ dir, upstream: '/nonexistent/repo.git', branch: 'dev' }),
    ).rejects.toMatchObject({
      category: 'not_found',
      code: 'GIT_CLONE_FAILED',
    });
  });
});

describe('SystemGit remote heads', () => {
  it('asks the remote where HEAD is and which branch that is, without fetching', async () => {
    const { bare, work } = upstream();
    const sys = new SystemGit(new NodeProcess());
    const clone = path.join(path.dirname(work), 'clone');
    git(['clone', '-q', '-o', 'upstream', bare, clone], path.dirname(work));
    const before = await sys.askRemoteHead(clone, 'upstream', 5000);
    expect(before).toEqual({ sha: await sys.sha(clone, 'upstream/dev'), branch: 'dev' });
    advance(work, 'two');
    const after = await sys.askRemoteHead(clone, 'upstream', 5000);
    expect(after?.sha).not.toBe(before?.sha);
    expect(await sys.sha(clone, 'upstream/dev')).toBe(before?.sha);
    expect(await sys.sha(clone, 'upstream/nope')).toBeUndefined();
  });

  it('answers undefined when the remote does not answer, and passes the timeout on', async () => {
    const proc = new FakeProcess();
    proc.always({ code: 128, stdout: '', stderr: 'fatal: could not read from remote' });
    const sys = new SystemGit(proc);
    expect(await sys.askRemoteHead('/w/x', 'upstream', 2000)).toBeUndefined();
    expect(proc.soleCallTo(['git', '-C', '/w/x', 'ls-remote'])).toMatchObject({
      vector: ['git', '-C', '/w/x', 'ls-remote', '--quiet', '--symref', 'upstream', 'HEAD'],
      options: { timeoutMs: 2000 },
    });
  });

  it('falls back to a plain ls-remote when this git does not know --symref', async () => {
    const proc = new FakeProcess();
    proc
      .when((v) => v.includes('--symref'), {
        code: 129,
        stdout: '',
        stderr: 'usage: git ls-remote',
      })
      .when((v) => v[3] === 'ls-remote', {
        code: 0,
        stdout: `${'c'.repeat(40)}\tHEAD\n`,
        stderr: '',
      });
    const sys = new SystemGit(proc);
    expect(await sys.askRemoteHead('/w/x', 'upstream', 2000)).toEqual({
      sha: 'c'.repeat(40),
      branch: undefined,
    });
    expect(proc.callsTo(['git', '-C', '/w/x', 'ls-remote'])).toHaveLength(2);
  });
});
