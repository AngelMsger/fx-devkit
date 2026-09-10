// The environments a workspace declares, and the error for one it does not.

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import type { Environments } from '../../domain/manifest/types.js';
import type { WorkspaceContext } from '../workspace-context.js';

export function environmentsOf(ctx: WorkspaceContext): Environments {
  const doc = ctx.manifest.environments?.result.doc;
  if (doc === undefined) {
    throw new DevkitError(
      'not_found',
      'ENVIRONMENTS_MISSING',
      'this workspace has no manifest/environments.yaml',
      {
        hint: 'Environments and platforms are declared there; without it there is nothing to list.',
        nextSteps: ['fx manifest explain envs --kind environments'],
      },
    );
  }
  return doc;
}

export function envNotFound(name: string, known: readonly string[]): DevkitError {
  const suggestion = nearest(name, known);
  return new DevkitError(
    'not_found',
    'ENV_NOT_FOUND',
    `"${name}" is not an environment of this workspace`,
    {
      hint:
        suggestion === undefined
          ? `Known: ${known.join(', ') || '(none)'}.`
          : `Did you mean "${suggestion}"?`,
      nextSteps: ['fx env list'],
    },
  );
}
