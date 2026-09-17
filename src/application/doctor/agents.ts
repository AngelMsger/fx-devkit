// Skills are never a failure: an agent without them still works, it just
// does not know fx.

import { SkillList } from '../skill/list.js';
import type { SkillDeps } from '../skill/targets.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

import { finding, type Finding } from './types.js';

export async function checkAgents(deps: WorkspaceDeps, skills: SkillDeps): Promise<Finding[]> {
  const rows = await new SkillList(deps, skills).execute({});
  const findings: Finding[] = [];
  const fix = workspaceCommand(deps, 'sync', '--only', 'skills');
  for (const row of rows) {
    for (const [agent, state] of Object.entries(row.states)) {
      const id = `${agent}:${row.name}`;
      if (state === 'installed') findings.push(finding('agents', id, 'ok', 'installed'));
      else if (state === 'foreign')
        findings.push(finding('agents', id, 'warn', 'a directory fx did not create is in the way'));
      else findings.push(finding('agents', id, 'warn', state, { fix }));
    }
  }
  if (findings.length === 0)
    findings.push(finding('agents', 'none', 'ok', 'no coding agent enabled on this machine'));
  return findings;
}
