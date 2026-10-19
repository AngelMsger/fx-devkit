// Applies planned resource changes under the caller's workspace lease.

import { DevkitError } from '../../domain/errors.js';
import type { HarnessState } from '../../domain/harness/ownership.js';
import { recoverHarnessState, snapshotDigest } from '../../domain/harness/state-recovery.js';
import { isLostWrite } from '../../domain/projection.js';

import type { HarnessChange, HarnessDeps, HarnessInput } from './types.js';

export async function applyHarnessChange(
  deps: HarnessDeps,
  input: HarnessInput,
  state: HarnessState,
  change: HarnessChange,
): Promise<HarnessState> {
  const pending = {
    key: change.key,
    relative: change.relative,
    before: snapshotDigest(change.before),
    after: snapshotDigest({ kind: change.text === null ? 'absent' : 'file', text: change.text }),
    receipt: change.receipt,
  };
  const prepared = { ...state, pending };
  await deps.state.write(input.workspace, prepared);
  const result = await deps.files.write({
    root: input.root,
    relative: change.relative,
    before: change.before,
    text: change.text,
  });
  if (isLostWrite(result)) throw harnessConflict();
  const observed = await deps.files.read({ root: input.root, relative: change.relative });
  const recovery = recoverHarnessState({ state: prepared, snapshot: observed });
  if (recovery.action !== 'finish') throw harnessConflict();
  await deps.state.write(input.workspace, recovery.state);
  return recovery.state;
}
export async function readHarnessState(
  deps: HarnessDeps,
  input: HarnessInput,
  persist: boolean,
): Promise<HarnessState> {
  const state = (await deps.state.read(input.workspace)) ?? {
    root: input.root,
    receipts: [],
    pending: null,
  };
  if (state.root !== input.root) throw harnessConflict();
  if (!state.pending) return state;
  const snapshot = await deps.files.read({ root: input.root, relative: state.pending.relative });
  const recovery = recoverHarnessState({ state, snapshot });
  if (recovery.action === 'conflict') throw harnessConflict();
  if (persist) await deps.state.write(input.workspace, recovery.state);
  return recovery.state;
}
export function harnessConflict(): DevkitError {
  return new DevkitError(
    'conflict',
    'HARNESS_PLAN_CHANGED',
    'Harness files or ownership changed after planning',
    {
      nextSteps: ['Inspect the native configuration and retry fx sync --only mcp,docs --dry-run.'],
      hint: 'User changes are preserved; do not remove ownership metadata to bypass this check.',
    },
  );
}
