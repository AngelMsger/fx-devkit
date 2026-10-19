// Atomic appends preserve concurrent audit events and reject foreign files.
import { randomUUID } from 'node:crypto';
import { readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ToolInstallation } from '../../../src/domain/toolchain/installation.js';
import { FileLock } from '../../../src/infra/lock.js';
import { FileToolHistoryStore } from '../../../src/infra/tool-history.js';
import { tempDir } from '../../temp.js';

async function fixture() {
  const root = tempDir('fx-tool-history-');
  return {
    root,
    file: path.join(root, 'tool-history.json'),
    store: new FileToolHistoryStore(root, new FileLock(root)),
  };
}
function event(): ToolInstallation {
  return {
    id: randomUUID(),
    at: '2026-09-16T00:00:00.000Z',
    event: 'started',
    operation: 'init',
    workspace: 'example',
    name: 'sample',
    binary: 'sample',
    via: 'npm',
    spec: '@example/sample',
    vector: ['npm', 'install', '-g', '@example/sample@latest'],
    code: null,
    version_after: null,
    binary_path: null,
    failure_code: null,
  };
}

describe('tool history file', () => {
  it('does not write on reads and retains concurrent appends from independent stores', async () => {
    const f = await fixture();
    expect(await f.store.read()).toEqual([]);
    await expect(stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
    const records = Array.from({ length: 10 }, event);
    await Promise.all(
      records.map((record) =>
        new FileToolHistoryStore(f.root, new FileLock(f.root)).append(record),
      ),
    );
    expect(await f.store.read()).toHaveLength(10);
    expect(new Set((await f.store.read()).map((row) => row.id))).toEqual(
      new Set(records.map((row) => row.id)),
    );
    if (process.platform !== 'win32') expect((await stat(f.file)).mode & 0o777).toBe(0o600);
  });
  it.each(['garbage', '{}', '{"owner":"someone-else","entries":[]}'])(
    'preserves unrecognized or corrupt history: %s',
    async (content) => {
      const f = await fixture();
      await writeFile(f.file, content);
      await expect(f.store.append(event())).rejects.toMatchObject({ code: 'TOOL_HISTORY_INVALID' });
      expect(await readFile(f.file, 'utf8')).toBe(content);
    },
  );
  it.skipIf(process.platform === 'win32')('preserves symlink destinations', async () => {
    const f = await fixture();
    const foreign = path.join(f.root, 'foreign');
    await writeFile(foreign, 'preserved');
    await symlink(foreign, f.file);
    await expect(f.store.append(event())).rejects.toMatchObject({ code: 'TOOL_HISTORY_INVALID' });
    expect(await readFile(foreign, 'utf8')).toBe('preserved');
  });
});

it('reads legacy evidence without claiming ownership and preserves it when appending v2 records', async () => {
  const f = await fixture();
  const legacy = event();
  await writeFile(f.file, JSON.stringify({ owner: 'fx:tool-history:v1', entries: [legacy] }));
  expect((await f.store.read())[0]?.installation_origin).toBeUndefined();
  const current = {
    ...event(),
    installation_origin: 'external' as const,
    binary_path_before: '/example/bin/sample',
  };
  await f.store.append(current);
  expect(await f.store.read()).toEqual([legacy, current]);
  expect(JSON.parse(await readFile(f.file, 'utf8')).owner).toBe('fx:tool-history:v2');
});
