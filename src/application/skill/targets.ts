// Resolve selected hosts to user Skill directories and deduplicated project links.

import type { AgentHost } from '../../ports/agent-host.js';
import type { Lock } from '../../ports/lock.js';
import { enabledHosts, findHost } from '../agent/list.js';

export interface SkillDeps {
  readonly globalLock: Lock;
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
  return wanted.map((id) => findHost(deps.hosts, id));
}
