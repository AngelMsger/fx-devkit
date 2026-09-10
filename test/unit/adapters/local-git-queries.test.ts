import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { LocalGitCodeHost } from '../../../src/adapters/code-host/local-git/provider.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { FakeClock } from '../../fakes/fake-clock.js';

const ref = { project: 'fx', name: 'a' };
const identity = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Alice',
  GIT_AUTHOR_EMAIL: 'alice@example.com',
  GIT_COMMITTER_NAME: 'Alice',
  GIT_COMMITTER_EMAIL: 'alice@example.com',
};
const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: identity }).trim();

// A bare repository whose `main` has one commit and whose `dev` has one more.
function seed(): { sut: LocalGitCodeHost; devHead: string; mainHead: string } {
  const host = mkdtempSync(path.join(tmpdir(), 'fx-host-'));
  mkdirSync(path.join(host, 'fx'));
  const bare = path.join(host, 'fx', 'a.git');
  git(['init', '--quiet', '--bare', '-b', 'main', bare], host);
  const work = path.join(host, 'work');
  git(['clone', '-q', bare, work], host);
  git(['checkout', '-q', '-b', 'main'], work);
  writeFileSync(path.join(work, 'package.json'), '{"version":"1.0.0"}\n');
  git(['add', '.'], work);
  git(['commit', '-q', '-m', 'init'], work);
  const mainHead = git(['rev-parse', 'HEAD'], work);
  git(['checkout', '-q', '-b', 'dev'], work);
  writeFileSync(path.join(work, 'VERSION'), '1.1.0\n');
  git(['add', '.'], work);
  git(['commit', '-q', '-m', 'feat: m-1 bump'], work);
  const devHead = git(['rev-parse', 'HEAD'], work);
  git(['push', '-q', 'origin', 'main', 'dev'], work);
  const sut = new LocalGitCodeHost(
    { process: new NodeProcess(), fs: new NodeFs(), clock: new FakeClock() },
    { host },
  );
  return { sut, devHead, mainHead };
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
        author: 'Alice',
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
      message: 'init',
      parents: [],
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
  });
});
