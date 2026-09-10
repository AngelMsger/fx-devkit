// Repository selection is the repos list of the personal scope; the only
// repository-specific part is which names exist and how a typo is answered.

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import type { WritePosture } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { editScope, type ScopeOutput } from '../workspace/scope.js';

export interface SelectionInput {
  readonly names: readonly string[];
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export type SelectionOutput = ScopeOutput;

export function editSelection(
  deps: WorkspaceDeps,
  input: SelectionInput,
  operation: 'pick' | 'unpick',
): Promise<SelectionOutput> {
  const shared = deps.ctx.manifest.workspace.result.doc.repos.map((r) => r.name);
  return editScope(deps, {
    key: 'repos',
    operation,
    universe: shared,
    names: input.names,
    dryRun: input.dryRun,
    posture: input.posture,
    notFound: (name) => {
      const suggestion = nearest(name, shared);
      return new DevkitError(
        'not_found',
        'REPO_NOT_FOUND',
        `"${name}" is not a shared repository of this workspace`,
        {
          hint:
            suggestion === undefined
              ? 'fx repo list shows the shared names.'
              : `Did you mean "${suggestion}"?`,
          nextSteps: ['fx repo list'],
        },
      );
    },
  });
}
