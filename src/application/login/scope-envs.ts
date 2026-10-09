// The personal environment selection belongs to `fx env select`; setup reads it and never
// asks for it. While it is unset every declared environment is in scope, and an invocation
// that names none of its own is told so and how to narrow it.

import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

export function noteUnsetEnvScope(deps: WorkspaceDeps, named: readonly string[] | undefined): void {
  if (deps.ctx.local.scope?.envs !== undefined || (named?.length ?? 0) > 0) return;
  const names = Object.keys(deps.ctx.manifest.environments?.result.doc.envs ?? {});
  if (names.length === 0) return;
  deps.reporter.notice({
    code: 'SCOPE_ENVS_UNSET',
    message: `All declared environments are selected: ${names.join(', ')}. Use env select to narrow the scope.`,
    nextSteps: [workspaceCommand(deps, 'env', 'select', '<env...>')],
  });
}
