// Recovery accepts only the exact pre-write or post-write file. Any third
// state belongs to an intervening actor and cannot acquire an fx receipt.

import { createHash } from 'node:crypto';

import type { HarnessState } from './ownership.js';

interface Snapshot {
  readonly kind: 'absent' | 'file' | 'foreign';
  readonly text: string | null;
}
export interface HarnessRecoveryInput {
  readonly state: HarnessState;
  readonly snapshot: Snapshot;
}
export interface HarnessRecovery {
  readonly action: 'none' | 'finish' | 'retry' | 'conflict';
  readonly state: HarnessState;
}

export function snapshotDigest(snapshot: Snapshot): string | null {
  return snapshot.kind === 'file'
    ? createHash('sha256')
        .update(snapshot.text ?? '')
        .digest('hex')
    : null;
}

export function recoverHarnessState({ state, snapshot }: HarnessRecoveryInput): HarnessRecovery {
  const pending = state.pending;
  if (!pending) return { action: 'none', state };
  if (snapshot.kind === 'foreign') return { action: 'conflict', state };
  const digest = snapshotDigest(snapshot);
  if (digest === pending.after) {
    const receipts = state.receipts.filter((receipt) => receipt.key !== pending.key);
    if (pending.receipt) receipts.push(pending.receipt);
    return { action: 'finish', state: { ...state, receipts, pending: null } };
  }
  if (digest === pending.before) return { action: 'retry', state: { ...state, pending: null } };
  return { action: 'conflict', state };
}
