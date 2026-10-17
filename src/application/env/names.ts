// The environments a workspace declares, and the error for one it does not.

import { DevkitError } from '../../domain/errors.js';
import type { Environments } from '../../domain/manifest/types.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { WorkspaceContext } from '../workspace/context.js';
import {
  workspaceCommand,
  workspaceItemNotFound,
  type WorkspaceGuidance,
} from '../workspace/guidance.js';

export function environmentsOf(ctx: WorkspaceContext, commandShell?: ResolvedShell): Environments {
  const doc = ctx.manifest.environments?.result.doc;
  if (doc === undefined) {
    throw new DevkitError(
      'not_found',
      'ENVIRONMENTS_MISSING',
      'This workspace has no manifest/environments.yaml',
      {
        hint: 'Environments and platforms are declared there; without it there is nothing to list.',
        nextSteps: [
          workspaceCommand(
            { ctx, commandShell },
            'manifest',
            'explain',
            'envs',
            '--kind',
            'environments',
          ),
        ],
      },
    );
  }
  return doc;
}

export function envNotFound(
  context: WorkspaceGuidance,
  name: string,
  known: readonly string[],
): DevkitError {
  return workspaceItemNotFound(context, { kind: 'env', name, known });
}
