// File-symlink cases require a POSIX host; junction behavior has native Windows coverage.
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ContributionOperation } from '../../../src/domain/contribution/operation.js';
import { FileContributionStore } from '../../../src/infra/contribution-store.js';
import { FileLock } from '../../../src/infra/lock.js';

const roots: string[] = [];
const record: ContributionOperation = {
  id: 'operation',
  branch: 'fx/contribution/operation',
  remoteIdentity: 'a'.repeat(64),
  base: 'a'.repeat(40),
  parent: 'a'.repeat(40),
  previousHead: null,
  sourceFingerprint: 'b'.repeat(64),
  paths: ['a.md'],
  files: ['a.md'],
  tree: 'b'.repeat(40),
  commit: null,
  phase: 'prepared',
  pullRequest: null,
  pullRequestId: null,
  baseBranch: 'main',
  updatedAt: '2026-09-09T00:00:00.000Z',
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'fx-contribution-store-'));
  roots.push(root);
  return {
    root,
    store: new FileContributionStore(root, new FileLock(root)),
    file: path.join(root, 'workspaces/test/contributions.json'),
  };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('contribution operation journal', () => {
  it('round-trips explicit pending state and treats absence as empty', async () => {
    const f = await fixture();
    expect(await f.store.read('test')).toEqual([]);
    await f.store.write('test', [record]);
    expect(await f.store.read('test')).toEqual([record]);
    await f.store.write('test', []);
    expect(await f.store.read('test')).toEqual([]);
  });
  it('rejects file bodies and invalid phases instead of persisting them', async () => {
    const f = await fixture();
    await expect(
      f.store.write('test', [
        { ...record, content: 'must never be written' } as ContributionOperation,
      ]),
    ).rejects.toMatchObject({ code: 'SOURCE_JOURNAL_INVALID' });
    await expect(f.store.write('test', [{ ...record, phase: 'open' }])).rejects.toMatchObject({
      code: 'SOURCE_JOURNAL_INVALID',
    });
    expect(await f.store.read('test')).toEqual([]);
  });
  it.each(['.GIT/config', 'docs/a\x7f.md'])(
    'refuses the recorded path %j on write and on read',
    async (file) => {
      const f = await fixture();
      const recorded = [{ ...record, paths: [file], files: [file] }];
      await expect(f.store.write('test', recorded)).rejects.toMatchObject({
        code: 'SOURCE_JOURNAL_INVALID',
      });
      await mkdir(path.dirname(f.file), { recursive: true });
      await writeFile(
        f.file,
        JSON.stringify({ owner: 'fx:contributions:v1', operations: recorded }),
      );
      await expect(f.store.read('test')).rejects.toMatchObject({ code: 'SOURCE_JOURNAL_INVALID' });
    },
  );
  it('preserves malformed or foreign metadata instead of replacing it', async () => {
    const f = await fixture();
    await f.store.write('test', [record]);
    await writeFile(f.file, 'foreign content');
    await expect(f.store.write('test', [])).rejects.toMatchObject({
      code: 'SOURCE_JOURNAL_INVALID',
    });
    expect(await readFile(f.file, 'utf8')).toBe('foreign content');
  });
  it.skipIf(process.platform === 'win32')('does not follow a foreign journal symlink', async () => {
    const f = await fixture();
    await f.store.write('test', [record]);
    const foreign = path.join(f.root, 'foreign');
    await writeFile(foreign, 'untouched');
    await rm(f.file);
    await symlink(foreign, f.file);
    await expect(f.store.write('test', [])).rejects.toMatchObject({
      code: 'SOURCE_JOURNAL_INVALID',
    });
    expect(await readFile(foreign, 'utf8')).toBe('untouched');
  });
});
