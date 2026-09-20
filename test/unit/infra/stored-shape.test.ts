// The evolution rule the personal stores share: a document written by a newer
// fx still loads, and nothing outside the contract is ever written back.
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileContributionStore } from '../../../src/infra/contribution-store.js';
import { FileHarnessState } from '../../../src/infra/harness-state.js';
import { FileHookState } from '../../../src/infra/hook-state.js';
import { FileLock } from '../../../src/infra/lock.js';
import { FileToolHistoryStore } from '../../../src/infra/tool-history.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function home(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fx-stored-shape-'));
  roots.push(dir);
  await mkdir(path.join(dir, 'workspaces/test'), { recursive: true });
  return dir;
}

const laterVersion = { from_a_later_fx: 'kept out of what we write' };

describe('a state file a later fx wrote', () => {
  it('loads the hook metadata instead of failing the workspace closed', async () => {
    const dir = await home();
    const file = path.join(dir, 'workspaces/test/hooks.json');
    const store = new FileHookState(dir);
    await store.write('test', {
      root: '/w',
      receipts: [{ agent: 'codex', relative: '.codex/hook', owner: 'o', created: true }],
      lastAttempt: null,
      lastRefresh: null,
      observations: [{ checkedAt: 1, phase: 'refresh', code: 'OK', command: null }],
    });
    const stored = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(
      file,
      JSON.stringify({
        ...stored,
        ...laterVersion,
        receipts: [{ ...stored.receipts[0], ...laterVersion }],
        observations: [{ ...stored.observations[0], ...laterVersion }],
      }),
    );

    const read = await store.read('test');
    expect(read?.receipts[0]?.agent).toBe('codex');
    expect(read?.observations[0]?.code).toBe('OK');
    expect(JSON.stringify(read)).not.toContain('from_a_later_fx');
    await store.write('test', read!);
    expect(await readFile(file, 'utf8')).not.toContain('from_a_later_fx');
  });

  it('loads the harness ownership journal, whose write still refuses a foreign field', async () => {
    const dir = await home();
    const file = path.join(dir, 'workspaces/test/harness.json');
    const store = new FileHarnessState(dir, new FileLock(dir));
    const state = { root: '/w', receipts: [], pending: null };
    await store.write('test', state);
    await writeFile(
      file,
      JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), ...laterVersion }),
    );
    expect(await store.read('test')).toEqual(state);
  });

  it('loads the tool history and appends to it without carrying the field forward', async () => {
    const dir = await home();
    const file = path.join(dir, 'tool-history.json');
    const entry = {
      id: '00000000-0000-4000-8000-000000000000',
      at: '2026-01-01T00:00:00.000Z',
      event: 'started',
      operation: 'install',
      workspace: null,
      name: 'a',
      binary: 'a',
      via: 'npm',
      spec: 'a',
      vector: ['npm'],
      code: null,
      version_after: null,
      binary_path: null,
      failure_code: null,
    } as const;
    await writeFile(
      file,
      JSON.stringify({
        owner: 'fx:tool-history:v2',
        entries: [{ ...entry, ...laterVersion }],
        ...laterVersion,
      }),
    );
    const store = new FileToolHistoryStore(dir, new FileLock(dir));
    expect(await store.read()).toHaveLength(1);
    await store.append({ ...entry, id: '00000000-0000-4000-8000-000000000001' });
    expect(await store.read()).toHaveLength(2);
    expect(await readFile(file, 'utf8')).not.toContain('from_a_later_fx');
  });

  it('loads the contribution journal', async () => {
    const dir = await home();
    const file = path.join(dir, 'workspaces/test/contributions.json');
    const store = new FileContributionStore(dir, new FileLock(dir));
    const operation = {
      id: 'abc',
      remoteIdentity: 'a'.repeat(64),
      branch: 'fx/contribution/abc',
      baseBranch: 'main',
      base: 'b'.repeat(40),
      parent: 'c'.repeat(40),
      previousHead: null,
      sourceFingerprint: 'd'.repeat(64),
      paths: ['notes.md'],
      files: ['notes.md'],
      tree: 'e'.repeat(40),
      commit: null,
      phase: 'prepared',
      pullRequestId: null,
      pullRequest: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as const;
    await store.write('test', [operation]);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(
      file,
      JSON.stringify({
        ...stored,
        ...laterVersion,
        operations: [{ ...stored.operations[0], ...laterVersion }],
      }),
    );
    expect(await store.read('test')).toEqual([operation]);
  });
});
