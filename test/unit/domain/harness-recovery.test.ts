import { describe, expect, it } from 'vitest';

import { recoverHarnessState, snapshotDigest } from '../../../src/domain/harness/state-recovery.js';

const snapshot = { kind: 'file' as const, text: 'new configuration' };
const receipt = {
  key: 'one',
  kind: 'mcp' as const,
  relative: '.mcp.json',
  protocol: 'json',
  name: 'fx-one',
  agents: ['one'],
  digest: 'a'.repeat(64),
  created: true,
};
const state = {
  root: '/workspace',
  receipts: [],
  pending: {
    key: 'one',
    relative: '.mcp.json',
    before: null,
    after: snapshotDigest(snapshot),
    receipt,
  },
};

describe('harness projection recovery', () => {
  it('finishes a receipt after its file was written and retries an unapplied intent', () => {
    expect(recoverHarnessState({ state, snapshot })).toMatchObject({
      action: 'finish',
      state: { receipts: [receipt], pending: null },
    });
    expect(recoverHarnessState({ state, snapshot: { kind: 'absent', text: null } })).toMatchObject({
      action: 'retry',
      state: { receipts: [], pending: null },
    });
  });
  it('never promotes user changes after an interrupted projection to ownership', () => {
    expect(
      recoverHarnessState({ state, snapshot: { kind: 'file', text: 'user change' } }),
    ).toMatchObject({ action: 'conflict', state });
    expect(recoverHarnessState({ state, snapshot: { kind: 'foreign', text: null } }).action).toBe(
      'conflict',
    );
  });
});
