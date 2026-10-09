// The role a value reads as. Purely cosmetic: a word missing from this table is shown
// unpainted, and no verdict is ever decided here.

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
    'updated',
    'created',
    'recorded',
  ],
  warn: [
    'warn',
    'outdated',
    'unknown',
    'unverified',
    'untrusted',
    'not_started',
    'incomplete',
    'foreign',
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
    'conflict',
    'invalid',
    'unauthorized',
    'unreadable',
    'not_installed',
    'root_missing',
  ],
  // Nothing happened, or nothing applies.
  quiet: [
    'unchanged',
    'skipped',
    'skip',
    'skip_unpicked',
    'skip_manifest',
    'unsupported',
    'disabled',
    'none',
    'not_applicable',
    'not_requested',
    'not_covered',
  ],
};

const ROLE_OF = new Map<string, Role>(
  Object.entries(VOCABULARY).flatMap(([role, words]) =>
    words.map((word): [string, Role] => [word, role as Role]),
  ),
);

// A zero count says nothing happened. A boolean is left alone: whether `false` is the
// good news depends on the field.
export function roleOf(value: unknown): Role | undefined {
  if (value === 0) return 'quiet';
  return typeof value === 'string' ? ROLE_OF.get(value) : undefined;
}
