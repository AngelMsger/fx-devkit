// What each word of a projection row means for the work that depends on its entry:
// done, ruled out by the host or a setting, or asked of fx and not managed.

import { describe, expect, it } from 'vitest';

import {
  harnessActionState,
  hookActionState,
  type HarnessAction,
  type HookAction,
  type ProjectionState,
} from '../../../src/domain/harness/actions.js';

const HARNESS_STATES: Readonly<Record<HarnessAction, ProjectionState>> = {
  unchanged: 'ready',
  created: 'ready',
  updated: 'ready',
  removed: 'ready',
  unsupported: 'skipped',
  untrusted: 'blocked',
  foreign: 'blocked',
  missing_variables: 'blocked',
  conflict: 'blocked',
};

const HOOK_STATES: Readonly<Record<HookAction, ProjectionState>> = {
  unchanged: 'ready',
  create: 'ready',
  update: 'ready',
  remove: 'ready',
  disabled: 'skipped',
  unsupported: 'skipped',
  foreign: 'blocked',
  invalid: 'blocked',
  busy: 'blocked',
  conflict: 'blocked',
};

describe('the state a projection row leaves its entry in', () => {
  it.each(Object.entries(HARNESS_STATES) as [HarnessAction, ProjectionState][])(
    'a harness row reporting %s is %s',
    (action, state) => {
      expect(harnessActionState(action)).toBe(state);
    },
  );

  it.each(Object.entries(HOOK_STATES) as [HookAction, ProjectionState][])(
    'a hook row reporting %s is %s',
    (action, state) => {
      expect(hookActionState(action)).toBe(state);
    },
  );
});
