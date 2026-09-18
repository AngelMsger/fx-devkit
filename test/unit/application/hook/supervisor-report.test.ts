import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { recordRunFailure } from '../../../../src/application/hook/supervisor-report.js';
import type { HookState } from '../../../../src/domain/harness/state.js';
import type { LockRequest } from '../../../../src/ports/lock.js';
import { FakeClock } from '../../../fakes/fake-clock.js';

const root = path.resolve('/workspace');

function stateOf(observations: HookState['observations'] = []): HookState {
  return { root, receipts: [], lastAttempt: 1, lastRefresh: null, observations };
}

function store(initial: HookState | null) {
  let state = initial;
  return {
    written: (): HookState | null => state,
    read: async (): Promise<HookState | null> => state,
    write: async (_workspace: string, next: HookState): Promise<void> => {
      state = next;
    },
  };
}

const granted = {
  acquire: async (): Promise<{ release: () => Promise<void> }> => ({ release: async () => {} }),
};

describe('how a supervised background run ended', () => {
  it('keeps the reason beside the phases the worker did not reach', async () => {
    const unreported = {
      phase: 'skills',
      code: 'HOOK_PHASE_UNREPORTED',
      command: 'fx sync --only skills',
      checkedAt: 10,
    };
    const state = store(
      stateOf([unreported, { ...unreported, phase: 'run', code: 'HOOK_TIMEOUT' }]),
    );
    await recordRunFailure(
      { clock: new FakeClock(), state, lock: granted },
      { workspace: 'test', root, reason: 'HOOK_ABORTED' },
    );
    expect(state.written()?.observations).toEqual([
      unreported,
      {
        phase: 'run',
        code: 'HOOK_ABORTED',
        command: 'fx sync',
        checkedAt: new FakeClock().now().getTime(),
      },
    ]);
  });

  it('writes nothing for an unregistered workspace or another root', async () => {
    const absent = store(null);
    await recordRunFailure(
      { clock: new FakeClock(), state: absent, lock: granted },
      { workspace: 'test', root, reason: 'HOOK_TIMEOUT' },
    );
    expect(absent.written()).toBeNull();

    const elsewhere = store(stateOf());
    await recordRunFailure(
      { clock: new FakeClock(), state: elsewhere, lock: granted },
      { workspace: 'test', root: path.resolve('/other'), reason: 'HOOK_TIMEOUT' },
    );
    expect(elsewhere.written()?.observations).toEqual([]);
  });

  it('skips a state lease another writer holds instead of waiting for it', async () => {
    const state = store(stateOf());
    const requests: LockRequest[] = [];
    await recordRunFailure(
      {
        clock: new FakeClock(),
        state,
        lock: {
          acquire: async (request) => {
            requests.push(request);
            return null;
          },
        },
      },
      { workspace: 'test', root, reason: 'HOOK_TIMEOUT' },
    );
    expect(requests).toEqual([{ key: 'hooks:test', waitMs: 0 }]);
    expect(state.written()?.observations).toEqual([]);
  });
});
