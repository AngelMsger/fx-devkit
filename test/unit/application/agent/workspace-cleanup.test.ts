// Removing an agent must preserve workspace lifecycle boundaries while cleaning
// other registered roots, including when an identity changes before its lease.
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { cleanupAgentWorkspaces } from '../../../../src/application/agent/workspace-cleanup.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLock } from '../../../fakes/fake-lock.js';

const input = {
  ids: ['codex'],
  dryRun: false,
  posture: { readOnly: false, source: 'default' as const },
  env: {},
};
const manifestDirFor = (name: string): string => path.resolve('/state', name, 'source');

describe('agent cleanup across workspaces', () => {
  it('continues after busy, unfinished, missing and failed roots without touching them', async () => {
    const names = ['busy', 'pending', 'missing', 'failed', 'ready'];
    const config = new FakeConfigStore({
      workspaces: Object.fromEntries(names.map((name) => [name, { root: `/${name}` }])),
    });
    const fs = FakeFs.from({ '/state/pending/workspace-operation.json': '{}' });
    fs.mkdir('/failed');
    fs.mkdir('/ready');
    const visited: string[] = [];
    const lock = new FakeLock().busy('workspace-operation:busy');
    const rows = await cleanupAgentWorkspaces(
      { config, fs, lock, manifestDirFor },
      {
        ...input,
        kind: 'harness',
        workspaces: names,
        async reconcile(workspace) {
          expect(lock.unreleased()).toContain(`workspace-operation:${workspace}`);
          visited.push(workspace);
          if (workspace === 'failed')
            throw new DevkitError('conflict', 'PROJECTION_CHANGED', 'Changed');
          return [{ workspace, agent: 'codex', kind: 'mcp', action: 'removed' }];
        },
      },
    );
    expect(visited).toEqual(['failed', 'ready']);
    expect(rows.map((row) => [row.workspace, row.action])).toEqual([
      ['busy', 'LOCK_BUSY'],
      ['pending', 'WORKSPACE_OPERATION_PENDING'],
      ['missing', 'root_missing'],
      ['failed', 'PROJECTION_CHANGED'],
      ['ready', 'removed'],
    ]);
    expect(
      rows.filter((row) => row.action !== 'removed').every((row) => row.kind === 'harness'),
    ).toBe(true);
    expect(lock.unreleased()).toEqual([]);
    expect(fs.writes).toEqual([]);
  });

  it('uses the current registration after acquiring the lease and skips unregistered roots', async () => {
    const config = new FakeConfigStore({
      workspaces: { moved: { root: '/old' }, removed: { root: '/removed' } },
    });
    const fs = new FakeFs();
    fs.mkdir('/new');
    const visited: string[] = [];
    const lock = new FakeLock().onAcquire(async () => {
      await config.write({ workspaces: { moved: { root: '/new' } } });
    });
    await cleanupAgentWorkspaces(
      { config, fs, lock, manifestDirFor },
      {
        ...input,
        workspaces: ['moved', 'removed'],
        async reconcile(_workspace, root) {
          visited.push(root);
          return [];
        },
      },
    );
    expect(visited).toEqual([path.resolve('/new')]);
  });

  it('previews without acquiring a lease and still reports pending identity operations', async () => {
    const config = new FakeConfigStore({ workspaces: { pending: { root: '/pending' } } });
    const fs = FakeFs.from({ '/state/pending/workspace-operation.json': '{}' });
    const lock = new FakeLock();
    const rows = await cleanupAgentWorkspaces(
      { config, fs, lock, manifestDirFor },
      {
        ...input,
        dryRun: true,
        workspaces: ['pending'],
        reconcile: async () => {
          throw new Error('Reconciled a pending identity');
        },
      },
    );
    expect(rows).toEqual([
      { workspace: 'pending', agent: 'codex', action: 'WORKSPACE_OPERATION_PENDING' },
    ]);
    expect(lock.requests).toEqual([]);
    expect(config.writes).toBe(0);
    expect(fs.writes).toEqual([]);
  });
});
