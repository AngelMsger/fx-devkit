import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { FileLock } from '../../../src/infra/lock.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
describe('recoverable directory projection', () => {
  it('restores a previous tree after interruption between directory renames', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fx-interrupted-'));
    dirs.push(root);
    const target = path.join(root, 'skill');
    const backup = `${target}.fx-old-test`;
    const staged = `${target}.fx-next-test`;
    await fs.mkdir(backup);
    await fs.writeFile(path.join(backup, 'old'), 'kept');
    await fs.mkdir(staged);
    await fs.writeFile(path.join(staged, 'partial'), 'incomplete');
    await fs.writeFile(`${target}.fx-transaction`, JSON.stringify({ target, backup, staged }));
    await expect(
      new NodeFs(new FileLock(root)).replaceDir(path.join(root, 'missing'), target),
    ).rejects.toBeDefined();
    expect(await fs.readFile(path.join(target, 'old'), 'utf8')).toBe('kept');
  });
  it('keeps the previous directory when preparing the replacement fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fx-replace-'));
    dirs.push(root);
    const target = path.join(root, 'skill');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'old'), 'kept');
    const store = new NodeFs(new FileLock(root));
    await expect(store.replaceDir(path.join(root, 'missing'), target)).rejects.toBeDefined();
    expect(await fs.readFile(path.join(target, 'old'), 'utf8')).toBe('kept');
    const source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'new'), 'ready');
    await store.replaceDir(source, target);
    expect(await fs.readFile(path.join(target, 'new'), 'utf8')).toBe('ready');
    expect(await store.exists(path.join(target, 'old'))).toBe(false);
  });
});
