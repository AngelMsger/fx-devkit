// A checkout that is not there or points elsewhere is broken; one with work
// in progress is merely busy.

import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';
import { Status } from '../workspace/status.js';

import { finding, type Finding } from './types.js';

export async function checkRepos(deps: WorkspaceDeps): Promise<Finding[]> {
  const rows = await new Status(deps).execute({ fetch: false, dirtyOnly: false });
  return rows.map((row) => {
    if (!row.exists)
      return finding('repos', row.name, 'fail', 'not cloned', {
        fix: workspaceCommand(deps, 'sync'),
      });
    if (row.branch === null && !row.remotes_ok)
      return finding('repos', row.name, 'fail', row.note ?? 'not a git checkout', {
        fix: workspaceCommand(deps, 'repo', 'show', row.name),
      });
    if (!row.remotes_ok)
      return finding('repos', row.name, 'fail', row.note ?? 'upstream remote differs', {
        fix: workspaceCommand(deps, 'repo', 'show', row.name),
      });
    const busy: string[] = [];
    if (row.uncommitted) busy.push('uncommitted changes');
    if (row.ahead > 0 && row.behind > 0)
      busy.push(`diverged (${row.ahead} ahead, ${row.behind} behind)`);
    if (row.branch !== null && row.tracked_branch !== null && row.branch !== row.tracked_branch)
      busy.push(`on ${row.branch}, tracking ${row.tracked_branch}`);
    return busy.length === 0
      ? finding('repos', row.name, 'ok', 'clean, on the tracked branch')
      : finding('repos', row.name, 'warn', busy.join('; '), {
          required:
            row.branch === row.tracked_branch && (row.dirty || (row.ahead > 0 && row.behind > 0)),
          fix: workspaceCommand(deps, 'repo', 'show', row.name),
        });
  });
}
