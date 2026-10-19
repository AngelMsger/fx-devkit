import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AutomaticSync } from '../../../../src/application/hook/automatic-sync.js';
import type { HookObservation, HookState } from '../../../../src/domain/harness/state.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeLock } from '../../../fakes/fake-lock.js';

describe('automatic workspace synchronization', () => {
  it('throttles failed refreshes while retrying local projections independently', async () => {
    let state: HookState | null = null;
    let refreshes = 0;
    let docs = 0;
    const clock = new FakeClock();
    const sync = new AutomaticSync({
      clock,
      lock: new FakeLock(),
      state: {
        read: async () => state,
        write: async (_name, next) => {
          state = next;
        },
      },
      canWrite: async () => true,
      refresh: async () => {
        refreshes++;
        throw new Error('network');
      },
      docs: async () => {
        docs++;
        return [];
      },
      skills: async () => [],
      root: async () => [],
      checks: async () => [],
    });
    await sync.execute({ workspace: 'test', root: path.resolve('/workspace') });
    clock.advance(16000);
    await sync.execute({ workspace: 'test', root: path.resolve('/workspace') });
    expect(refreshes).toBe(1);
    expect(docs).toBe(2);
    expect(
      (state as HookState | null)?.observations.find((o) => o.code === 'MANIFEST_REFRESH_FAILED'),
    ).toMatchObject({ detail: 'INTERNAL: network' });
  });
  it('dates every phase it commits to, so a run killed mid-phase is not silent', async () => {
    let state: HookState | null = null;
    const clock = new FakeClock();
    const observation = (phase: string, code: string): HookObservation => ({
      phase,
      code,
      command: null,
      checkedAt: clock.now().getTime(),
    });
    const sync = new AutomaticSync({
      clock,
      lock: new FakeLock(),
      state: {
        read: async () => state,
        write: async (_name, next) => {
          state = next;
        },
      },
      canWrite: async () => true,
      refresh: async () => [observation('manifest', 'MANIFEST_UP_TO_DATE')],
      docs: async () => [observation('docs', 'DOCS_CURRENT')],
      // The supervisor kills the worker group here; nothing later ever runs.
      skills: () => new Promise(() => {}),
      root: async () => [observation('root', 'ROOT_ACCOUNTED')],
      checks: async () => [observation('checks', 'LOGIN_CHECKED')],
    });
    void sync.execute({ workspace: 'test', root: path.resolve('/workspace') });
    await vi.waitFor(() =>
      expect(state?.observations.map((o) => o.code)).toContain('MANIFEST_UP_TO_DATE'),
    );
    await vi.waitFor(() =>
      expect(state?.observations.map((o) => o.code)).toContain('DOCS_CURRENT'),
    );
    expect(
      [...((state as HookState | null)?.observations ?? [])]
        .sort((a, b) => a.phase.localeCompare(b.phase))
        .map((o) => [o.phase, o.code, o.command]),
    ).toEqual([
      ['checks', 'HOOK_PHASE_UNREPORTED', 'fx doctor'],
      ['docs', 'DOCS_CURRENT', null],
      ['manifest', 'MANIFEST_UP_TO_DATE', null],
      ['root', 'ROOT_ACCOUNTED', null],
      ['skills', 'HOOK_PHASE_UNREPORTED', 'fx sync --only skills'],
    ]);
  });
});
