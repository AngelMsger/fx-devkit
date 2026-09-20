// Resolve the write posture and gate planned user-requested changes. Dry-run
// callers return their plan before this gate; operational caches have separate policy.

import { DevkitError } from '../../domain/errors.js';
import { parseBoolean } from '../../domain/values.js';

export const READ_ONLY_ENV = 'FX_READ_ONLY';

export interface WritePosture {
  readonly readOnly: boolean;
  readonly source: 'flag' | 'env' | 'file' | 'default';
}

export interface PostureInput {
  readonly allowWrites: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly file: { readonly read_only?: boolean };
}

export function resolvePosture(input: PostureInput): WritePosture {
  if (input.allowWrites) return { readOnly: false, source: 'flag' };
  const fromEnv = parseBoolean(input.env[READ_ONLY_ENV]);
  if (fromEnv !== undefined) return { readOnly: fromEnv, source: 'env' };
  if (input.file.read_only !== undefined) return { readOnly: input.file.read_only, source: 'file' };
  return { readOnly: false, source: 'default' };
}

// Background work has no invocation to resolve a posture from: dispatch refuses
// to start it unless the session is already writable, so its phases run under
// the built-in writable answer rather than one a flag, variable or file argued for.
export const BACKGROUND_POSTURE: WritePosture = { readOnly: false, source: 'default' };

export function assertWritable(posture: WritePosture, operation: string): void {
  if (!posture.readOnly) return;
  throw new DevkitError(
    'permission',
    'READONLY_BLOCKED',
    `${operation} was not applied: this session is read-only (from ${posture.source})`,
    {
      hint: `Pass --allow-writes for this one invocation, or unset read_only / ${READ_ONLY_ENV}.`,
      nextSteps: [
        'Re-run with --dry-run to see the plan without applying it.',
        'Re-run with --allow-writes to apply it.',
      ],
    },
  );
}
