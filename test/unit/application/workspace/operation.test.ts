import { describe, expect, it } from 'vitest';

import { beginWorkspaceCommand } from '../../../../src/application/workspace/command-operation.js';
import { withWorkspaceOperation } from '../../../../src/application/workspace/operation.js';
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
        'workspace',
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PLAN_CHANGED' });
    expect(released).toBe(true);
  });

  it('uses the shared operation namespace', async () => {
    const keys: string[] = [];
    const lock = {
      acquire: async (input: { key: string }) => {
        keys.push(input.key);
        return { release: async () => undefined };
      },
    };
    await withWorkspaceOperation(lock, 'alpha', async () => undefined);
    expect(keys).toEqual(['workspace-operation:alpha']);
  });
});
