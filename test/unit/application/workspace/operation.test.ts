import { describe, expect, it } from 'vitest';

import { beginWorkspaceCommand } from '../../../../src/application/workspace/command-operation.js';
import { withWorkspaceOperation } from '../../../../src/application/workspace/operation.js';
import { workspaceWriteMode } from '../../../../src/cli/workspace-write-policy.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';

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
    for (const id of ['manifest:repo-set', 'manifest:render'])
      expect(workspaceWriteMode(id, {})).toBe('source');
    expect(workspaceWriteMode('doctor', {})).toBe(null);
    expect(workspaceWriteMode('doctor', { fix: true })).toBe('workspace');
  });
  it('locks conditional and compatibility writers without classifying read-only checks as writes', () => {
    expect(workspaceWriteMode('where', { record: true, check: true })).toBe('workspace');
    expect(workspaceWriteMode('where', { record: true, check: false })).toBe('workspace');
    expect(workspaceWriteMode('where', { probe: true, check: true })).toBe(null);
    expect(workspaceWriteMode('status', { fetch: true })).toBe('workspace');
    expect(workspaceWriteMode('status', {})).toBe(null);
    expect(workspaceWriteMode('manifest:render', { check: true })).toBe(null);
    expect(workspaceWriteMode('manifest:render', { check: false })).toBe('source');
    expect(workspaceWriteMode('manifest:record-probe', { check: true })).toBe('workspace');
    for (const id of ['hook:inject', 'hook:remove'])
      expect(workspaceWriteMode(id, {})).toBe('workspace');
    expect(workspaceWriteMode('manifest:set', {})).toBe('source');
    expect(workspaceWriteMode('source:push', {})).toBe(null);
    for (const [id, flags] of [
      ['where', { record: true, check: true }],
      ['status', { fetch: true }],
    ] as const)
      expect(workspaceWriteMode(id, { ...flags, 'dry-run': true })).toBe(null);
  });
});
