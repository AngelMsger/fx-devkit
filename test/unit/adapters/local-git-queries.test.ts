import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { LocalGitCodeHost } from '../../../src/adapters/code-host/local-git/provider.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { NodeProcess } from '../../../src/adapters/process/node-process.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { git, repository } from '../../git.js';
import { tempDir } from '../../temp.js';

const ref = { project: 'fx', name: 'a' };

// A bare repository whose `main` has one commit and whose `dev` has one more.
function seed(): { sut: LocalGitCodeHost; devHead: string; mainHead: string } {
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
