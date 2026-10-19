// File-symlink cases require a POSIX host; junction behavior has native Windows coverage.
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { HarnessState } from '../../../src/domain/harness/ownership.js';
import { recoverHarnessState, snapshotDigest } from '../../../src/domain/harness/state-recovery.js';
import { FileHarnessState } from '../../../src/infra/harness-state.js';
import { FileLock } from '../../../src/infra/lock.js';
import { FileProjectionStore } from '../../../src/infra/projection-store.js';

const roots: string[] = [];
const state = { root: '/workspace', receipts: [], pending: null };
async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), 'fx-harness-state-'));
  roots.push(home);
  return {
    home,
    store: new FileHarnessState(home, new FileLock(home)),
    file: path.join(home, 'workspaces/test/harness.json'),
  };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('harness ownership journal', () => {
  it('treats absence explicitly and persists only owned metadata', async () => {
    const f = await fixture();
    expect(await f.store.read('test')).toBeNull();
    await f.store.write('test', state);
    expect(await f.store.read('test')).toEqual(state);
    await expect(
      f.store.write('test', { ...state, content: 'must not persist' } as HarnessState),
    ).rejects.toMatchObject({ code: 'HARNESS_STATE_INVALID' });
    expect(await readFile(f.file, 'utf8')).not.toContain('must not persist');
  });
  it.skipIf(process.platform === 'win32')(
    'refuses foreign files and symlinks instead of overwriting them',
    async () => {
      const f = await fixture();
      await f.store.write('test', state);
      await writeFile(f.file, 'foreign');
      await expect(f.store.write('test', state)).rejects.toMatchObject({
        code: 'HARNESS_STATE_INVALID',
      });
      expect(await readFile(f.file, 'utf8')).toBe('foreign');
      await rm(f.file);
      const target = path.join(f.home, 'other');
      await writeFile(target, 'untouched');
      await symlink(target, f.file);
      await expect(f.store.write('test', state)).rejects.toMatchObject({
        code: 'HARNESS_STATE_INVALID',
      });
      expect(await readFile(target, 'utf8')).toBe('untouched');
    },
  );
  it.each(['.GIT/config', 'rules/a\x7f.md'])(
    'refuses the recorded path %j on write and on read',
    async (relative) => {
      const f = await fixture();
      const receipt = {
        key: 'one',
        kind: 'rules' as const,
        relative,
        protocol: 'markdown',
        name: 'fx-one',
        agents: ['one'],
        digest: 'a'.repeat(64),
        created: true,
      };
      const recorded = { ...state, receipts: [receipt] };
      await expect(f.store.write('test', recorded)).rejects.toMatchObject({
        code: 'HARNESS_STATE_INVALID',
      });
      await mkdir(path.dirname(f.file), { recursive: true });
      await writeFile(f.file, JSON.stringify({ owner: 'fx:harness:v1', ...recorded }));
      await expect(f.store.read('test')).rejects.toMatchObject({ code: 'HARNESS_STATE_INVALID' });
    },
  );
  it('recovers a receipt from disk after interruption between file and metadata writes', async () => {
    const f = await fixture();
    const files = new FileProjectionStore(new FileLock(f.home));
    const relative = '.mcp.json';
    const root = path.join(f.home, 'workspace');
    const text = '{"mcpServers":{}}\n';
    const receipt = {
      key: 'one',
      kind: 'mcp' as const,
      relative,
      protocol: 'json',
      name: 'fx-one',
      agents: ['one'],
      digest: 'a'.repeat(64),
      created: true,
    };
    await f.store.write('test', {
      root,
      receipts: [],
      pending: {
        key: 'one',
        relative,
        before: null,
        after: snapshotDigest({ kind: 'file', text }),
        receipt,
      },
    });
    expect(
      await files.write({ root, relative, before: { kind: 'absent', text: null }, text }),
    ).toBe('written');
    const reloaded = await new FileHarnessState(f.home, new FileLock(f.home)).read('test');
    const recovery = recoverHarnessState({
      state: reloaded!,
      snapshot: await files.read({ root, relative }),
    });
    expect(recovery.action).toBe('finish');
    await f.store.write('test', recovery.state);
    expect(await f.store.read('test')).toMatchObject({ pending: null, receipts: [receipt] });
    expect(await readFile(f.file, 'utf8')).not.toContain('mcpServers');
  });
});
