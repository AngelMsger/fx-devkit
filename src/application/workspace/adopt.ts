// Add a missing upstream only while the unchanged origin still exactly proves the planned URL.

import { DevkitError } from '../../domain/errors.js';
import { shellLine } from '../../domain/shell.js';
import type { PlanItem } from '../../domain/workspace/plan.js';

import type { WorkspaceDeps } from './deps.js';

export async function prepareUpstream(
  deps: WorkspaceDeps,
  item: PlanItem,
  dir: string,
): Promise<boolean> {
  const expected = item.upstream_to_add;
  if (expected === undefined) return false;
  const remotes = await deps.git.remotes(dir);
  if (remotes['upstream'] === expected) return false;
  if (remotes['upstream'] !== undefined || remotes['origin'] !== expected)
    throw new DevkitError(
      'conflict',
      'REPO_REMOTES_CHANGED',
      `Remotes changed before adopting ${item.name}; existing remotes were preserved.`,
      {
        nextSteps: [
          shellLine(['git', '-C', dir, 'remote', '-v'], deps.commandShell),
          shellLine(['fx', 'sync', '--workspace', deps.ctx.name, '--dry-run'], deps.commandShell),
        ],
      },
    );
  await deps.git.addRemote(dir, 'upstream', expected);
  return true;
}
