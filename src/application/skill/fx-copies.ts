// The bundled fx Skill is a copy, not a link, and is recognized by its name and
// version frontmatter; an unversioned same-name directory is foreign.

import path from 'node:path';

import { decideCopy } from '../../domain/skills/projection.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { SkillCopies } from './copies.js';
import { FX_SKILL, observeCopy } from './observe.js';
import { applyItem } from './outcome.js';
import { skillTargets, type SkillDeps } from './targets.js';
import type { FxSkillItem, SkillStageInput } from './types.js';

export async function planCopies(
  deps: WorkspaceDeps,
  skills: SkillDeps,
  agents: readonly string[] | undefined,
): Promise<FxSkillItem[]> {
  const items: FxSkillItem[] = [];
  for (const target of await skillTargets(skills, agents)) {
    const at = path.join(target.dir, FX_SKILL);
    const action = decideCopy(await observeCopy(deps.fs, at), deps.cliVersion);
    items.push({ agent: target.agent, path: at, action, version: deps.cliVersion });
  }
  return items;
}

export async function applyCopies(
  deps: WorkspaceDeps,
  skills: SkillDeps,
  items: FxSkillItem[],
  input: SkillStageInput,
): Promise<void> {
  const copies = new SkillCopies(deps.fs, deps.cliVersion, skills);
  for (const [index, item] of items.entries()) {
    await applyItem(items, index, async () => {
      const action = await copies.install(item.path, {
        posture: input.posture,
        ...(input.background || input.replace === undefined ? {} : { replace: input.replace }),
      });
      items[index] = {
        ...item,
        action,
        ...(action === 'install' || action === 'upgrade' ? {} : { status: 'skipped' as const }),
      };
    });
  }
}
