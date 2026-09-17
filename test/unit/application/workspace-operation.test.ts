import { describe, expect, it } from 'vitest';

import { beginWorkspaceCommand } from '../../../src/application/workspace/command-operation.js';
import { withWorkspaceOperation } from '../../../src/application/workspace/operation.js';
import { workspaceWriteMode } from '../../../src/cli/workspace-write-policy.js';
import { FakeConfigStore } from '../../fakes/fake-config-store.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeReporter } from '../../fakes/fake-reporter.js';

describe('workspace operation leases', () => {
  it('rejects a context whose identity changes while a writer waits and releases the lease', async () => {
    const config = new FakeConfigStore({
      workspaces: { alpha: { root: '/old', source: '/source' } },
    });
    let released = false;
    const lock = {
      acquire: async () => {
        await config.write({ workspaces: { alpha: { root: '/moved', source: '/source' } } });
        return {
          release: async () => {
            released = true;
          },
        };
      },
    };
    await expect(
      beginWorkspaceCommand(
        {
          cwd: '/old',
          name: 'alpha',
          config,
          fs: new FakeFs(),
          reporter: new FakeReporter(),
          manifestDirFor: () => '/personal/alpha/source',
        },
        lock,
        false,
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PLAN_CHANGED' });
    expect(released).toBe(true);
  });

  it('never acquires write leases for previews and uses the shared operation namespace for apply', async () => {
    const keys: string[] = [];
    const lock = {
      acquire: async (input: { key: string }) => {
        keys.push(input.key);
        return { release: async () => undefined };
      },
    };
    expect(await withWorkspaceOperation(lock, 'alpha', true, async () => 'preview')).toBe(
      'preview',
    );
    expect(keys).toEqual([]);
    await withWorkspaceOperation(lock, 'alpha', false, async () => undefined);
    expect(keys).toEqual(['workspace-operation:alpha']);
    for (const id of [
      'sync',
      'repo:pick',
      'repo:select',
      'env:select',
      'repo:add',
      'repo:remove',
      'repo:fork',
      'hook:enable',
      'hook:disable',
      'login',
      'manifest:record-probe',
    ]) {
      expect(workspaceWriteMode(id, {})).toBe('workspace');
      expect(workspaceWriteMode(id, { 'dry-run': true })).toBe(null);
    }
    for (const id of ['source:push', 'manifest:repo-set', 'manifest:render'])
      expect(workspaceWriteMode(id, {})).toBe('source');
    expect(workspaceWriteMode('doctor', {})).toBe(null);
    expect(workspaceWriteMode('doctor', { fix: true })).toBe('workspace');
  });
});
