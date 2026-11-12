import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { LocalGitCodeHost } from '../../../src/adapters/code-host/local-git/provider.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { readVersionHistory } from '../../../src/application/release/version-history.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { git, repository } from '../../git.js';
import { tempDir } from '../../temp.js';

const ref = { project: 'fx', name: 'a' };

// A bare repository whose `main` has one commit and whose `dev` has one more.
function seed(): { sut: LocalGitCodeHost; devHead: string; mainHead: string; bare: string } {
  const host = tempDir('fx-host-');
  const { bare } = repository(
    path.join(host, 'fx'),
    'a',
    { 'package.json': '{"version":"1.0.0"}\n' },
    { dev: { files: { VERSION: '1.1.0\n' }, message: 'feat: m-1 bump' } },
  );
  const mainHead = git(['rev-parse', 'main'], bare);
  const devHead = git(['rev-parse', 'dev'], bare);
  const sut = new LocalGitCodeHost(
    { process: new NodeProcess(), fs: new NodeFs(), clock: new FakeClock() },
    { host },
  );
  return { sut, devHead, mainHead, bare };
}

describe('LocalGitCodeHost queries', () => {
  let seeded: ReturnType<typeof seed>;
  beforeAll(() => {
    seeded = seed();
  });

  it('lists the branches of the bare repository and marks the default', async () => {
    const branches = await seeded.sut.branches(ref);
    expect(branches).toEqual(
      expect.arrayContaining([
        { name: 'main', sha: seeded.mainHead, default: true },
        { name: 'dev', sha: seeded.devHead, default: false },
      ]),
    );
  });

  it('answers what dev has that main lacks, and nothing the other way', async () => {
    const ahead = await seeded.sut.compare(ref, { from: 'main', to: 'dev' });
    expect(ahead).toEqual([
      expect.objectContaining({
        sha: seeded.devHead,
        author: 'T',
        message: 'feat: m-1 bump',
        parents: [seeded.mainHead],
      }),
    ]);
    expect(ahead[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await seeded.sut.compare(ref, { from: 'dev', to: 'main' })).toEqual([]);
  });

  it('reads one commit', async () => {
    expect(await seeded.sut.commit(ref, seeded.mainHead)).toMatchObject({
      sha: seeded.mainHead,
      message: 'one',
      parents: [],
    });
  });

  it('resolves a branch and annotated tag to the commit SHA', async () => {
    const separate = seed();
    git(
      [
        '-c',
        'user.name=Example',
        '-c',
        'user.email=example@example.com',
        'tag',
        '-a',
        'v1.0.0',
        '-m',
        'Release',
        separate.mainHead,
      ],
      separate.bare,
    );
    expect(await separate.sut.commit(ref, 'v1.0.0')).toMatchObject({
      sha: separate.mainHead,
      parents: [],
    });
    expect(await separate.sut.commit(ref, 'dev')).toMatchObject({
      sha: separate.devHead,
      parents: [separate.mainHead],
    });
  });

  it('reads the raw committer timestamp rather than the author timestamp', async () => {
    const separate = seed();
    const tree = git(['rev-parse', `${separate.mainHead}^{tree}`], separate.bare);
    const input = `tree ${tree}\nparent ${separate.mainHead}\nauthor Example <example@example.com> 1609459200 +0000\ncommitter Example <example@example.com> 1640995200 +0800\n\nVersion change\n`;
    const sha = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
      cwd: separate.bare,
      input,
      encoding: 'utf8',
    }).trim();
    expect(await separate.sut.commit(ref, sha)).toMatchObject({
      sha,
      date: '2022-01-01T00:00:00.000Z',
      parents: [separate.mainHead],
    });
  });

  it('preserves raw parents at a shallow boundary and reports unavailable ancestors', async () => {
    const separate = seed();
    const shallowRoot = tempDir('fx-shallow-host-');
    mkdirSync(path.join(shallowRoot, 'fx'));
    const shallowBare = path.join(shallowRoot, 'fx/a.git');
    git(
      [
        'clone',
        '--bare',
        '--depth',
        '1',
        '--branch',
        'dev',
        pathToFileURL(separate.bare).href,
        shallowBare,
      ],
      shallowRoot,
    );
    const shallowHost = new LocalGitCodeHost(
      { process: new NodeProcess(), fs: new NodeFs(), clock: new FakeClock() },
      { host: shallowRoot },
    );
    expect(await shallowHost.commit(ref, 'dev')).toMatchObject({ parents: [separate.mainHead] });
    // The object header itself, rather than rev-list's shallow view, is the evidence.
    expect(git(['rev-list', '--parents', '-1', 'dev'], shallowBare)).toBe(separate.devHead);
    await expect(
      shallowHost.compare(ref, { from: separate.devHead, to: separate.devHead }),
    ).rejects.toMatchObject({ code: 'CODE_HOST_SHALLOW_HISTORY', category: 'incomplete' });
    const actual = await readVersionHistory({ host: shallowHost, ref, requestedRef: 'dev' });
    expect(actual).toMatchObject({
      coverage: 'incomplete',
      last_change: null,
      next_sha: separate.mainHead,
      termination: 'query_failed',
    });
  });

  it('reads a file at a ref, and answers undefined for a path that is not there', async () => {
    expect(await seeded.sut.readFile(ref, 'VERSION', 'dev')).toBe('1.1.0\n');
    expect(await seeded.sut.readFile(ref, 'VERSION', 'main')).toBeUndefined();
    expect(await seeded.sut.readFile(ref, 'package.json', 'main')).toBe('{"version":"1.0.0"}\n');
  });

  it('throws, rather than answering, when the ref itself does not exist', async () => {
    await expect(seeded.sut.compare(ref, { from: 'main', to: 'ghost' })).rejects.toMatchObject({
      code: 'PLATFORM_QUERY_FAILED',
    });
    await expect(seeded.sut.readFile(ref, 'VERSION', 'ghost')).rejects.toMatchObject({
      code: 'PLATFORM_QUERY_FAILED',
    });
  });
});
