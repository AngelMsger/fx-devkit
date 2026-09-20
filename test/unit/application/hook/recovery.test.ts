// Projection failures must not commit a preference that hides pending recovery.
import { describe, expect, it } from 'vitest';

import { ReconcileHooks } from '../../../../src/application/hook/reconcile.js';
import type { HookDeps } from '../../../../src/application/hook/types.js';
import type { HookState } from '../../../../src/domain/harness/state.js';
import type { AgentHost } from '../../../../src/ports/agent-host.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { FakeLocalStore } from '../../../fakes/fake-local-store.js';

function fixture(result: 'written' | 'busy' | 'conflict' | 'io') {
  const local = FakeLocalStore.with('test', { hooks: { enabled: false } });
  let state: HookState | null = null;
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
    lock: { acquire: async () => ({ release: async () => {} }) },
    files: {
      read: async () => ({ kind: 'absent', text: null }),
      write: async () => {
        if (result === 'io') throw new Error('IO');
        return result;
      },
    },
    protocol: () => ({
      project: () => ({ status: 'managed', text: '{}' }),
      context: () => '',
      decode: () => null,
    }),
    executable: ['fx'],
    home: '/test/home',
  };
  return { local, deps, state: () => state };
}
const input = {
  workspace: 'test',
  root: '/test/root',
  action: 'inject' as const,
  globalEnabled: true,
  configured: ['example'],
  dryRun: false,
  posture: { readOnly: false, source: 'default' as const },
};

describe('hook preference commit', () => {
  it.each(['busy', 'conflict', 'io'] as const)(
    'preserves disabled preference on %s',
    async (result) => {
      const s = fixture(result);
      const run = new ReconcileHooks(s.deps).execute(input);
      if (result === 'io') await expect(run).rejects.toThrow('IO');
      else
        expect(await run).toMatchObject({
          enabled: false,
          items: [expect.objectContaining({ action: result })],
        });
      expect((await s.local.read('test')).hooks?.enabled).toBe(false);
    },
  );
  it('commits preference only after the projection receipt is saved', async () => {
    const s = fixture('written');
    await new ReconcileHooks(s.deps).execute(input);
    expect((await s.local.read('test')).hooks?.enabled).toBe(true);
    expect(s.state()?.receipts).toHaveLength(1);
  });
});
