// The repositories half of the personal scope; the edit itself is editScope's.

import type { WritePosture } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceItemNotFound } from '../workspace/guidance.js';
import { editScope, type ScopeOperation, type ScopeOutput } from '../workspace/scope.js';

export interface RepoScopeInput {
  readonly names: readonly string[];
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export function editRepoScope(
  deps: WorkspaceDeps,
  input: RepoScopeInput,
  operation: ScopeOperation,
): Promise<ScopeOutput> {
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
