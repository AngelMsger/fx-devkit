// The role a value reads as. Purely cosmetic: a word missing from this table is shown
// unpainted, and no verdict is ever decided here.

import {
  HARNESS_ACTIONS,
  HOOK_ACTIONS,
  harnessActionState,
  hookActionState,
  type HarnessAction,
  type HookAction,
  type ProjectionState,
} from '../../domain/harness/actions.js';

import type { Role } from './display.js';

const VOCABULARY: Readonly<Partial<Record<Role, readonly string[]>>> = {
  ok: [
    'ok',
    'ready',
    'done',
    'verified',
    'complete',
    'completed',
    'installed',
    'reachable',
    'available',
    'up_to_date',
    'recorded',
  ],
  warn: [
    'warn',
    'outdated',
    'unknown',
    'unverified',
    'not_started',
    'incomplete',
    'diverged',
    'skip_dirty',
    'skip_diverged',
    'skip_not_git',
    'skip_remote_mismatch',
  ],
  fail: [
    'fail',
    'failed',
    'blocked',
    'missing',
    'unauthorized',
    'unreadable',
    'not_installed',
    'root_missing',
  ],
  // Nothing happened, or nothing applies.
  quiet: [
    'skipped',
    'skip',
    'skip_unpicked',
    'skip_manifest',
    'none',
    'not_applicable',
    'not_requested',
    'not_covered',
  ],
};

type ProjectionAction = HarnessAction | HookAction;

// A projection action reads as its state does, unless it is named in ACTION_ROLE.
const STATE_ROLE: Readonly<Record<ProjectionState, Role>> = {
  ready: 'ok',
  skipped: 'quiet',
  blocked: 'fail',
};

// `null` leaves the word unpainted.
const ACTION_ROLE: Readonly<Partial<Record<ProjectionAction, Role | null>>> = {
  unchanged: 'quiet',
  removed: null,
  remove: null,
  untrusted: 'warn',
  foreign: 'warn',
  missing_variables: 'warn',
};

function actionEntries(action: ProjectionAction, state: ProjectionState): [string, Role][] {
  const named = ACTION_ROLE[action];
  const role = named === undefined ? STATE_ROLE[state] : named;
  return role === null ? [] : [[action, role]];
}

const ROLE_OF = new Map<string, Role>([
  ...Object.entries(VOCABULARY).flatMap(([role, words]) =>
    words.map((word): [string, Role] => [word, role as Role]),
  ),
  ...HARNESS_ACTIONS.flatMap((action) => actionEntries(action, harnessActionState(action))),
  ...HOOK_ACTIONS.flatMap((action) => actionEntries(action, hookActionState(action))),
]);

// A zero count says nothing happened. A boolean is left alone: whether `false` is the
// good news depends on the field.
export function roleOf(value: unknown): Role | undefined {
  if (value === 0) return 'quiet';
  return typeof value === 'string' ? ROLE_OF.get(value) : undefined;
}
