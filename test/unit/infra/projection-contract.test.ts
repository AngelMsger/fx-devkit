// The ProjectionStore port, asserted once against the disk and against the
// fake that application tests plan and apply through.

import { realpathSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { projectionLeaseKey } from '../../../src/domain/lease.js';
import { FileLock } from '../../../src/infra/lock.js';
import { FileProjectionStore } from '../../../src/infra/projection-store.js';
import type { FileSystem } from '../../../src/ports/fs.js';
import type { Lock } from '../../../src/ports/lock.js';
import type { ProjectionStore } from '../../../src/ports/projection.js';
import { FakeFileProjection } from '../../fakes/fake-file-projection.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { tempDir } from '../../temp.js';

interface Subject {
  readonly store: ProjectionStore;
  // Arranges and inspects the tree the store projects into.
  readonly fs: FileSystem;
  readonly lock: Lock;
  readonly root: string;
}

function onDisk(): Subject {
  const lock = new FileLock(tempDir('projection-contract-locks-'));
  return {
    store: new FileProjectionStore(lock),
    fs: new NodeFs(),
    lock,
    root: realpathSync(tempDir('projection-contract-')),
  };
}

function inMemory(): Subject {
  const lock = new FileLock(tempDir('projection-contract-locks-'));
  const fs = new FakeFs();
  return { store: new FakeFileProjection(fs, lock), fs, lock, root: path.resolve('/workspace') };
}

describe.each([
  ['FileProjectionStore', onDisk],
  ['FakeFileProjection', inMemory],
])('%s as a ProjectionStore', (_, subject) => {
  it('observes an absent path, a regular file, and a directory or a link as foreign', async () => {
    const { store, fs, root } = subject();
    await fs.writeText(path.join(root, 'AGENTS.md'), 'guide');
    await fs.ensureDir(path.join(root, 'directory'));
    await fs.link(path.join(root, 'AGENTS.md'), path.join(root, 'linked.md'));

    expect(await store.read({ root, relative: 'absent.md' })).toEqual({
      kind: 'absent',
      text: null,
    });
    expect(await store.read({ root, relative: 'AGENTS.md' })).toEqual({
      kind: 'file',
      text: 'guide',
    });
    expect(await store.read({ root, relative: 'directory' })).toEqual({
      kind: 'foreign',
      text: null,
    });
    expect(await store.read({ root, relative: 'linked.md' })).toEqual({
      kind: 'foreign',
      text: null,
    });
  });

  it('observes a path below a linked directory as foreign and writes nothing through it', async () => {
    const { store, fs, root } = subject();
    await fs.writeText(path.join(root, 'elsewhere', 'hooks.json'), 'theirs');
    await fs.link(path.join(root, 'elsewhere'), path.join(root, '.agent'));
    const at = { root, relative: '.agent/hooks.json' };

    const before = await store.read(at);
    const result = await store.write({ ...at, before, text: 'fx' });

    expect(before).toEqual({ kind: 'foreign', text: null });
    expect(result).toBe('conflict');
    expect(await fs.readText(path.join(root, 'elsewhere', 'hooks.json'))).toBe('theirs');
  });

  it('creates, rewrites and removes a file planned against what is there', async () => {
    const { store, fs, root } = subject();
    const at = { root, relative: '.agent/hooks.json' };
    const file = path.join(root, '.agent', 'hooks.json');

    const created = await store.write({ ...at, before: await store.read(at), text: 'first' });
    const rewritten = await store.write({ ...at, before: await store.read(at), text: 'second' });
    const text = await fs.readText(file);
    const removed = await store.write({ ...at, before: await store.read(at), text: null });

    expect([created, rewritten, removed]).toEqual(['written', 'written', 'written']);
    expect(text).toBe('second');
    expect(await fs.exists(file)).toBe(false);
  });

  it('answers unchanged when the planned text is what was observed', async () => {
    const { store, fs, root } = subject();
    const at = { root, relative: 'AGENTS.md' };
    await fs.writeText(path.join(root, 'AGENTS.md'), 'guide');

    expect(await store.write({ ...at, before: await store.read(at), text: 'guide' })).toBe(
      'unchanged',
    );
    expect(await store.write({ ...at, before: { kind: 'absent', text: null }, text: null })).toBe(
      'unchanged',
    );
  });

  it('answers conflict and keeps a file that changed after it was observed', async () => {
    const { store, fs, root } = subject();
    const at = { root, relative: 'AGENTS.md' };
    const before = await store.read(at);
    await fs.writeText(path.join(root, 'AGENTS.md'), 'written by someone else');

    expect(await store.write({ ...at, before, text: 'fx' })).toBe('conflict');
    expect(await fs.readText(path.join(root, 'AGENTS.md'))).toBe('written by someone else');
  });

  it('answers busy and writes nothing while another writer holds the path', async () => {
    const { store, fs, lock, root } = subject();
    const at = { root, relative: 'AGENTS.md' };
    const before = await store.read(at);
    const held = await lock.acquire({
      key: projectionLeaseKey(path.join(root, 'AGENTS.md')),
      waitMs: 0,
    });

    const contended = await store.write({ ...at, before, text: 'fx' });
    await held?.release();
    const afterRelease = await store.write({ ...at, before, text: 'fx' });

    expect(held).not.toBeNull();
    expect(contended).toBe('busy');
    expect(afterRelease).toBe('written');
    expect(await fs.readText(path.join(root, 'AGENTS.md'))).toBe('fx');
  });
});
