import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileLock } from '../../../src/infra/lock.js';
import { FileProjectionStore } from '../../../src/infra/projection-store.js';
import { tempDir } from '../../temp.js';

describe('projection writes', () => {
  it('refuses an outdated plan and paths reached through foreign symlinks', async () => {
    const root = tempDir('fx-projection-');
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

describe('link projection writes', () => {
  it('rejects redirected ancestors both while planning and after a valid snapshot', async () => {
    const root = await fs.realpath(tempDir('fx-link-projection-'));
    const outside = path.join(root, 'outside');
    const workspace = path.join(root, 'workspace');
    const target = path.join(root, 'source');
    for (const dir of [outside, workspace, target, path.join(workspace, '.agent')])
      await fs.mkdir(dir, { recursive: true });
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(target, path.join(workspace, '.agent/skills'), kind);
    await fs.symlink(target, path.join(outside, 'skills'), kind);
    const store = new FileProjectionStore(new FileLock(path.join(root, 'state')));
    const at = { root: workspace, relative: '.agent/skills' };
    const before = await store.readLink(at);
    expect(before).toEqual({ kind: 'link', target });
    await fs.rename(path.join(workspace, '.agent'), path.join(workspace, '.agent-old'));
    await fs.symlink(outside, path.join(workspace, '.agent'), kind);
    expect(await store.readLink(at)).toMatchObject({ kind: 'unsafe' });
    expect(await store.writeLink({ ...at, before, target: null })).toBe('conflict');
    expect(await store.writeLink({ ...at, before, target: path.join(root, 'new-source') })).toBe(
      'conflict',
    );
    expect(await fs.readlink(path.join(outside, 'skills'))).toBe(target);
    expect(await fs.readlink(path.join(workspace, '.agent-old/skills'))).toBe(target);
  });
});
