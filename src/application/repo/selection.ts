// Repository selection is the repos list of the personal scope; the only
// repository-specific part is which names exist and how a typo is answered.

import type { WritePosture } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceItemNotFound } from '../workspace/guidance.js';
import { editScope, type ScopeOperation, type ScopeOutput } from '../workspace/scope.js';

export interface SelectionInput {
  readonly names: readonly string[];
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export type SelectionOutput = ScopeOutput;

export function editSelection(
  deps: WorkspaceDeps,
  input: SelectionInput,
  operation: ScopeOperation,
): Promise<SelectionOutput> {
  const shared = deps.ctx.manifest.workspace.result.doc.repos.map((r) => r.name);
  return editScope(deps, {
    key: 'repos',
    operation,
    universe: shared,
    names: input.names,
    dryRun: input.dryRun,
    posture: input.posture,
    notFound: (name) =>
      workspaceItemNotFound(deps, { kind: 'repo', name, known: shared, shared: true }),
  });
}
