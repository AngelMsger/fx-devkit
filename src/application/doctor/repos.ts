// A checkout that is not there or points elsewhere is broken; one with work
// in progress is merely busy.

import { Status } from '../status.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { finding, type Finding } from './types.js';

export async function checkRepos(deps: WorkspaceDeps): Promise<Finding[]> {
  const rows = await new Status(deps).execute({ fetch: false, dirtyOnly: false });
  return rows.map((row) => {
    if (!row.exists) return finding('repos', row.name, 'fail', 'not cloned', { fix: 'fx sync' });
    if (row.branch === null && !row.remotes_ok)
      return finding('repos', row.name, 'fail', row.note ?? 'not a git checkout', {
        fix: `fx repo show ${row.name}`,
      });
    if (!row.remotes_ok)
      return finding('repos', row.name, 'fail', row.note ?? 'upstream remote differs', {
        fix: `fx repo show ${row.name}`,
      });
    const busy: string[] = [];
    if (row.uncommitted) busy.push('uncommitted changes');
    if (row.ahead > 0 && row.behind > 0)
      busy.push(`diverged (${row.ahead} ahead, ${row.behind} behind)`);
    if (row.branch !== null && row.tracked_branch !== null && row.branch !== row.tracked_branch)
      busy.push(`on ${row.branch}, tracking ${row.tracked_branch}`);
    return busy.length === 0
      ? finding('repos', row.name, 'ok', 'clean, on the tracked branch')
      : finding('repos', row.name, 'warn', busy.join('; '), { fix: `fx repo show ${row.name}` });
  });
}
