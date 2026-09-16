// Resolve the family CLI target flags without requiring a workspace or its agent selection.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { pathKey } from '../../domain/path.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { FileSystem } from '../../ports/fs.js';

import { canonicalSkillPath } from './copies.js';
import { FX_SKILL } from './observe.js';

export interface StandaloneTargetsInput {
  readonly agents?: readonly string[] | undefined;
  readonly project?: boolean | undefined;
  readonly dir?: string | undefined;
  readonly cwd: string;
}

export interface StandaloneTarget {
  readonly agent?: string;
  readonly path: string;
}

export async function standaloneTargets(
  fs: FileSystem,
  hosts: readonly AgentHost[],
  input: StandaloneTargetsInput,
  inspect = false,
): Promise<StandaloneTarget[]> {
  const ids = input.agents?.flatMap((a) => a.split(',').map((id) => id.trim()));
  if (input.dir !== undefined) {
    if (ids?.length || input.project || !input.dir.trim())
      throw new DevkitError(
        'usage',
        'SKILL_FLAGS',
        '--dir requires a path and excludes --agent and --project',
        {
          nextSteps: ['fx skill install --help'],
        },
      );
    return [{ path: path.resolve(input.cwd, input.dir, FX_SKILL) }];
  }
  const scope = input.project ? 'project' : 'global';
  const selected: AgentHost[] = [];
  if (ids !== undefined) {
    for (const id of ids) {
      const host = hosts.find((h) => h.id === id);
      if (!host)
        throw new DevkitError('usage', 'SKILL_AGENT', `Unknown agent "${id}"`, {
          hint: `Supported agents: ${hosts.map((h) => h.id).join(', ')}`,
          nextSteps: ['fx skill path'],
        });
      selected.push(host);
    }
  } else {
    for (const host of hosts)
      if (inspect || (await host.detect(scope, input.cwd))) selected.push(host);
  }
  if (!inspect && selected.length === 0)
    throw new DevkitError('usage', 'SKILL_NO_AGENT', 'No coding agent detected', {
      nextSteps: ['fx skill path', 'Pass --agent <id> or --dir <path> to choose a target.'],
    });
  const targets = selected.map((host) => ({
    agent: host.id,
    path: path.resolve(host.skillsDir(scope, input.cwd), FX_SKILL),
  }));
  if (inspect) return targets.sort((a, b) => a.agent.localeCompare(b.agent));
  const byPath = new Map<string, StandaloneTarget>();
  for (const target of targets) {
    const key = pathKey(await canonicalSkillPath(fs, target.path));
    const previous = byPath.get(key);
    byPath.set(
      key,
      previous
        ? {
            ...previous,
            agent: [...new Set([...(previous.agent ?? '').split(', '), target.agent])].join(', '),
          }
        : target,
    );
  }
  return [...byPath.values()];
}
