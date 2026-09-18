// One directory link per selected agent to the manifest's Skills tree. A location
// holding anything fx did not create is foreign and is reported, never replaced.

import { decideLink } from '../../domain/skills/projection.js';
import { assertWritable } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { observeLink, teamSkillsRoot } from './observe.js';
import { applyItem } from './outcome.js';
import { projectSkillTargets, type SkillDeps } from './targets.js';
import type { SkillLinkItem, SkillStageInput } from './types.js';

export async function planLinks(
  deps: WorkspaceDeps,
  skills: SkillDeps,
  agents: readonly string[] | undefined,
): Promise<SkillLinkItem[]> {
  const { fs, ctx } = deps;
  const target = teamSkillsRoot(ctx.manifestDir);
  const hasSource = await fs.isDirectory(target);
  const items: SkillLinkItem[] = [];
  for (const at of await projectSkillTargets(skills, ctx.root, agents)) {
    const decision = decideLink(await observeLink(fs, at.dir), target, hasSource);
    items.push({
      agent: at.agent,
      path: at.dir,
      target,
      action: decision.action,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    });
  }
  return items;
}

export async function replaceConflicts(
  deps: WorkspaceDeps,
  input: SkillStageInput,
  links: SkillLinkItem[],
): Promise<void> {
  const conflicts: SkillLinkItem[] = [];
  for (const item of links) {
    if (item.action === 'foreign' && (await deps.fs.isDirectory(item.target))) conflicts.push(item);
  }
  if (input.replace !== undefined && conflicts.length > 0) {
    assertWritable(input.posture, 'replace Skill paths');
    if (await input.replace(conflicts.map((item) => item.path))) {
      for (let index = 0; index < links.length; index++) {
        const item = links[index]!;
        if (conflicts.includes(item)) links[index] = { ...item, action: 'create' };
      }
    }
  }
}

export async function applyLinks(deps: WorkspaceDeps, items: SkillLinkItem[]): Promise<void> {
  for (const [index, item] of items.entries()) {
    await applyItem(items, index, async () => {
      if (item.action === 'create') await deps.fs.link(item.target, item.path);
      else if (item.action === 'prune') await deps.fs.remove(item.path);
      else items[index] = { ...item, status: 'skipped' };
    });
  }
}

export function reportForeign(deps: WorkspaceDeps, links: readonly SkillLinkItem[]): void {
  const foreign = links.filter((i) => i.action === 'foreign');
  if (foreign.length === 0) return;
  deps.reporter.notice({
    code: 'SKILL_FOREIGN',
    message: `${foreign.length} Skill location(s) hold something fx did not create and were left alone: ${foreign.map((f) => f.path).join(', ')}`,
    nextSteps: ['Move or remove them by hand if the team Skills should be linked there.'],
  });
}
