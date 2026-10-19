import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { replacementFor } from '../../../src/application/safety/replace-files.js';
import { pathKey } from '../../../src/domain/path.js';
import { FileLock } from '../../../src/infra/lock.js';
import { FakePrompter } from '../../fakes/fake-prompter.js';
import { FakeReporter } from '../../fakes/fake-reporter.js';
import { tempDir } from '../../temp.js';

async function fixture() {
  const root = await fs.realpath(tempDir('fx-approved-'));
  const store = new NodeFs(new FileLock(root));
  return {
    root,
    store,
    replace: replacementFor(store, new FakePrompter(), new FakeReporter(), true),
  };
}

describe('approved path replacement', () => {
  it('preserves an editor save through its open file handle in the moved backup', async () => {
    const { root, replace, store } = await fixture();
    const target = path.join(root, 'AGENTS.md');
    await fs.writeFile(target, 'Original guide');
    await fs.writeFile(`${target}.fx-backup`, 'Earlier backup');
    const editor = await fs.open(target, 'r+');
    try {
      await replace([target]);
      await editor.truncate(0);
      await editor.writeFile('Latest editor save');
    } finally {
      await editor.close();
    }
    expect(await store.exists(target)).toBe(false);
    expect(await fs.readFile(`${target}.fx-backup-1`, 'utf8')).toBe('Latest editor save');
    expect(await fs.readFile(`${target}.fx-backup`, 'utf8')).toBe('Earlier backup');
    await fs.writeFile(target, 'New editor document at original path');
    expect(await fs.readFile(`${target}.fx-backup-1`, 'utf8')).toBe('Latest editor save');
    expect(await fs.readFile(target, 'utf8')).toBe('New editor document at original path');
  });

  it('serializes parallel replacements without overwriting an existing backup', async () => {
    const { root, store } = await fixture();
    const target = path.join(root, 'AGENTS.md');
    await fs.writeFile(target, 'Preserve once');
    await fs.writeFile(`${target}.fx-backup`, 'Previous recovery point');
    const busy = await new FileLock(root).acquire({
      key: `projection:${pathKey(`${target}.fx-backup-1`)}`,
      waitMs: 0,
    });
    try {
      await expect(store.moveToBackup(target)).rejects.toMatchObject({ code: 'LOCK_BUSY' });
      expect(await fs.readFile(target, 'utf8')).toBe('Preserve once');
    } finally {
      await busy?.release();
    }
    const other = new NodeFs(new FileLock(root));
    const results = await Promise.allSettled([
      store.moveToBackup(target),
      other.moveToBackup(target),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toEqual([
      { status: 'fulfilled', value: `${target}.fx-backup-1` },
    ]);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'PROJECTION_CHANGED' },
    });
    expect(await fs.readFile(`${target}.fx-backup`, 'utf8')).toBe('Previous recovery point');
    expect(await fs.readFile(`${target}.fx-backup-1`, 'utf8')).toBe('Preserve once');
  });

  it.skipIf(process.platform === 'win32')(
    'preserves trees and links through stable directory aliases and rejects changed aliases',
    async () => {
      const { root, store, replace } = await fixture();
      const tree = path.join(root, 'personal-skill');
      const link = path.join(root, 'AGENTS.md');
      await fs.mkdir(tree);
      await fs.writeFile(path.join(tree, 'SKILL.md'), 'Personal skill');
      await fs.symlink(path.join(tree, 'SKILL.md'), link);
      await fs.symlink(path.join(root, 'missing'), `${link}.fx-backup`);
      await replace([link, tree]);
      expect(await fs.readlink(`${link}.fx-backup-1`)).toBe(path.join(tree, 'SKILL.md'));
      expect(await fs.readlink(`${link}.fx-backup`)).toBe(path.join(root, 'missing'));
      expect(await fs.readFile(`${tree}.fx-backup/SKILL.md`, 'utf8')).toBe('Personal skill');
      const redirected = path.join(root, 'redirected');
      await fs.symlink(`${tree}.fx-backup`, redirected);
      const backup = await store.moveToBackup(path.join(redirected, 'SKILL.md'));
      expect(await fs.readFile(backup, 'utf8')).toBe('Personal skill');
      await fs.writeFile(`${tree}.fx-backup/SKILL.md`, 'Latest skill');
      const other = path.join(root, 'other-directory');
      await fs.mkdir(other);
      await fs.writeFile(path.join(other, 'SKILL.md'), 'Unrelated skill');
      const lock = new FileLock(root);
      const changing = new NodeFs({
        acquire: async (input) => {
          const lease = await lock.acquire(input);
          await fs.unlink(redirected);
          await fs.symlink(other, redirected);
          return lease;
        },
      });
      await expect(changing.moveToBackup(path.join(redirected, 'SKILL.md'))).rejects.toMatchObject({
        code: 'PROJECTION_CHANGED',
      });
      expect(await fs.readFile(`${tree}.fx-backup/SKILL.md`, 'utf8')).toBe('Latest skill');
      expect(await fs.readFile(path.join(other, 'SKILL.md'), 'utf8')).toBe('Unrelated skill');
    },
  );
});
