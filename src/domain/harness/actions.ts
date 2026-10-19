// The words a projection row reports for one native entry, and what each means for
// the work that depends on the entry. A harness row names the edit in the past
// tense and a hook row in the imperative; both spellings are published values.

export const HARNESS_ACTIONS = [
  'unchanged',
  'created',
  'updated',
  'removed',
  'untrusted',
  'foreign',
  'missing_variables',
  'conflict',
  'unsupported',
] as const;
export type HarnessAction = (typeof HARNESS_ACTIONS)[number];

export const HOOK_ACTIONS = [
  'unchanged',
  'create',
  'update',
  'remove',
  'foreign',
  'invalid',
  'busy',
  'conflict',
  'disabled',
  'unsupported',
] as const;
export type HookAction = (typeof HOOK_ACTIONS)[number];

// `skipped` is an entry the host or a setting rules out; `blocked` is one fx was
// asked to manage and could not.
export type ProjectionState = 'ready' | 'skipped' | 'blocked';

export function harnessActionState(action: HarnessAction): ProjectionState {
  switch (action) {
    case 'unchanged':
    case 'created':
    case 'updated':
    case 'removed':
      return 'ready';
    case 'unsupported':
      return 'skipped';
    case 'untrusted':
    case 'foreign':
    case 'missing_variables':
    case 'conflict':
      return 'blocked';
  }
}

export function hookActionState(action: HookAction): ProjectionState {
  switch (action) {
    case 'unchanged':
    case 'create':
    case 'update':
    case 'remove':
      return 'ready';
    case 'disabled':
    case 'unsupported':
      return 'skipped';
    case 'foreign':
    case 'invalid':
    case 'busy':
    case 'conflict':
      return 'blocked';
  }
}
