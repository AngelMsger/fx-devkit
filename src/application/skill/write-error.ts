// Identify denied Skill filesystem effects, including errors wrapped by IO ports.
// Keep other structured failures intact and retain the underlying OS cause.

import { DevkitError } from '../../domain/errors.js';

export function skillWriteError(error: unknown, target: string): unknown {
  let current = error;
  const seen = new Set<unknown>();
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const cause = current as { code?: unknown; path?: unknown; cause?: unknown };
    if (cause.code === 'EPERM' || cause.code === 'EACCES') {
      const resource = typeof cause.path === 'string' ? cause.path : target;
      return new DevkitError(
        'permission',
        'SKILL_WRITE_DENIED',
        `Cannot prepare Skill ${target}: ${cause.code} at ${resource}`,
        {
          cause: error,
          retryable: false,
          hint: 'Global Skill targets and their shared lock can be outside FX_HOME. Preparation remains incomplete until this filesystem access is available.',
          nextSteps: [
            'fx skill show',
            'Continue source analysis in the repositories already prepared.',
            'To synchronize repositories and guides only: fx sync --only repos,docs --no-refresh-manifest --format json',
            `Inspect filesystem access to ${resource}; retry Skill preparation only after access changes.`,
          ],
        },
      );
    }
    current = cause.cause;
  }
  return error;
}
