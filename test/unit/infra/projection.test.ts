import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileLock } from '../../../src/infra/lock.js';
import { FileProjectionStore } from '../../../src/infra/projection-store.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('projection writes', () => {
  it('refuses an outdated plan and paths reached through foreign symlinks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fx-projection-'));
    dirs.push(root);
    const store = new FileProjectionStore(new FileLock(root));
    const at = { root, relative: '.agent/hooks.json' };
    const before = await store.read(at);
    await fs.mkdir(path.join(root, '.agent'));
    await fs.writeFile(path.join(root, '.agent/hooks.json'), 'user');
    expect(await store.write({ ...at, before, text: 'fx' })).toBe('conflict');
    expect(await fs.readFile(path.join(root, '.agent/hooks.json'), 'utf8')).toBe('user');
    await fs.symlink(
      path.join(root, '.agent'),
      path.join(root, '.alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect((await store.read({ root, relative: '.alias/hooks.json' })).kind).toBe('foreign');
  });
});
