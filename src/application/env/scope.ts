// The environments half of the personal scope; the edit itself is editScope's.

import type { WorkspaceDeps } from '../workspace/deps.js';
import {
  editScope,
  type ScopeOperation,
  type ScopeOutput,
  type ScopeSelection,
} from '../workspace/scope.js';

import { envNotFound, environmentsOf } from './names.js';

export function editEnvScope(
  deps: WorkspaceDeps,
  input: ScopeSelection,
  operation: ScopeOperation,
): Promise<ScopeOutput> {
  const known = Object.keys(environmentsOf(deps.ctx, deps.commandShell).envs);
  return editScope(deps, {
    key: 'envs',
    operation,
    universe: known,
    names: input.names,
    dryRun: input.dryRun,
    posture: input.posture,
    notFound: (name) => envNotFound(deps, name, known),
  });
}
