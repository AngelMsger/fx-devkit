import { describe, expect, it } from 'vitest';

import { beginWorkspaceCommand } from '../../../../src/application/workspace/command-operation.js';
import { withWorkspaceOperation } from '../../../../src/application/workspace/operation.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';

describe('workspace operation leases', () => {
  it('rejects a context whose identity changes while a writer waits and releases the lease', async () => {
    const config = new FakeConfigStore({
      workspaces: { alpha: { root: '/old', source: '/source' } },
    });
    const lock = new FakeLock().onAcquire(async () => {
      await config.write({ workspaces: { alpha: { root: '/moved', source: '/source' } } });
    });
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
    expect(lock.requests).not.toEqual([]);
    expect(lock.unreleased()).toEqual([]);
  });

  it('uses the shared operation namespace', async () => {
    const lock = new FakeLock();
    await withWorkspaceOperation(lock, 'alpha', async () => undefined);
    expect(lock.requests.map((request) => request.key)).toEqual(['workspace-operation:alpha']);
  });
});
