// Projection failures must not commit a preference that hides pending recovery.
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ReconcileHooks } from '../../../../src/application/hook/reconcile.js';
import type { HookDeps } from '../../../../src/application/hook/types.js';
import type { HookState } from '../../../../src/domain/harness/state.js';
import type { AgentHost } from '../../../../src/ports/agent-host.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { FakeFileProjection } from '../../../fakes/fake-file-projection.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLocalStore } from '../../../fakes/fake-local-store.js';
import { FakeLock } from '../../../fakes/fake-lock.js';

const ROOT = path.resolve('/test/root');
const HOOKS = path.join(ROOT, '.example/hooks.json');

function fixture() {
  const local = FakeLocalStore.with('test', { hooks: { enabled: false } });
  let state: HookState | null = null;
  const fs = new FakeFs();
  const projecting = new FakeLock();
  const host: AgentHost = Object.assign(new FakeAgentHost('example', true), {
    hooks: {
      projectPath: '.example/hooks.json',
      protocol: 'json',
      events: { 'session-start': 'start' },
      context: 'none' as const,
      identityEnvironment: [],
    },
  });
  const deps: HookDeps = {
    hosts: [host],
    local,
    state: {
      read: async () => state,
      write: async (_, next) => {
        state = next;
      },
    },
    lock: new FakeLock(),
    files: new FakeFileProjection(fs, projecting),
    protocol: () => ({
      project: () => ({ status: 'managed', text: '{}' }),
      context: () => '',
      decode: () => null,
    }),
    executable: ['fx'],
    home: '/test/home',
  };
  return { local, deps, fs, projecting, state: () => state };
}
type Fixture = ReturnType<typeof fixture>;
const input = {
  workspace: 'test',
  root: ROOT,
  action: 'inject' as const,
  globalEnabled: true,
  configured: ['example'],
  dryRun: false,
  posture: { readOnly: false, source: 'default' as const },
};

describe('hook preference commit', () => {
  it.each([
    {
      result: 'busy',
      obstruct: (s: Fixture): void => {
        s.projecting.busy();
      },
    },
    {
      result: 'conflict',
      obstruct: (s: Fixture): void => {
        s.projecting.onAcquire(() => s.fs.writeText(HOOKS, 'written by another process'));
      },
    },
  ])('preserves disabled preference on $result', async ({ result, obstruct }) => {
    const s = fixture();
    obstruct(s);
    expect(await new ReconcileHooks(s.deps).execute(input)).toMatchObject({
      enabled: false,
      items: [expect.objectContaining({ action: result })],
    });
    expect((await s.local.read('test')).hooks?.enabled).toBe(false);
  });

  it('preserves disabled preference when the projection write fails', async () => {
    const s = fixture();
    s.projecting.onAcquire(() => {
      throw new Error('IO');
    });
    await expect(new ReconcileHooks(s.deps).execute(input)).rejects.toThrow('IO');
    expect((await s.local.read('test')).hooks?.enabled).toBe(false);
  });

  it('commits preference only after the projection receipt is saved', async () => {
    const s = fixture();
    await new ReconcileHooks(s.deps).execute(input);
    expect((await s.local.read('test')).hooks?.enabled).toBe(true);
    expect(s.state()?.receipts).toHaveLength(1);
  });
});
