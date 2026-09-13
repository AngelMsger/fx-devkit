// Where Skills go. fx's own Skill: the enabled agents' global skill
// directories. The team Skills: the same agents' project skill directories
// at the workspace root, one target per directory because several agents
// share `.agents/skills`. Both narrow to the agents named, when any are.

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { Lock } from '../../ports/lock.js';
import { enabledHosts } from '../agent/list.js';

export interface SkillDeps {
  readonly globalLock?: Lock;
  readonly hosts: readonly AgentHost[];
  readonly configured: readonly string[] | undefined;
  readonly bundledSkillDir: string;
}

export interface SkillTarget {
  readonly agent: string;
  readonly dir: string;
}

export async function skillTargets(
  deps: SkillDeps,
  agents: readonly string[] | undefined,
): Promise<SkillTarget[]> {
  return (await selectHosts(deps, agents)).map((h) => ({
    agent: h.id,
    dir: h.skillsDir('global'),
  }));
}

export async function projectSkillTargets(
  deps: SkillDeps,
  root: string,
  agents: readonly string[] | undefined,
): Promise<SkillTarget[]> {
  const byDir = new Map<string, string[]>();
  for (const host of await selectHosts(deps, agents)) {
    const dir = host.skillsDir('project', root);
    byDir.set(dir, [...(byDir.get(dir) ?? []), host.id]);
  }
  return [...byDir].map(([dir, ids]) => ({ agent: ids.join(', '), dir }));
}

async function selectHosts(
  deps: SkillDeps,
  wanted: readonly string[] | undefined,
): Promise<AgentHost[]> {
  if (wanted === undefined) return enabledHosts(deps.hosts, deps.configured);
  return wanted.map((id) => {
    const host = deps.hosts.find((h) => h.id === id);
    if (host === undefined) {
      const suggestion = nearest(
        id,
        deps.hosts.map((h) => h.id),
      );
      throw new DevkitError('not_found', 'AGENT_UNKNOWN', `"${id}" is not an agent fx knows`, {
        hint:
          suggestion === undefined
            ? 'fx agent list shows the known ids.'
            : `Did you mean "${suggestion}"?`,
        nextSteps: ['fx agent list'],
      });
    }
    return host;
  });
}
