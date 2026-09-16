// Read team Skill metadata for both source and derived guide rendering.

import path from 'node:path';

import type { TeamSkillEntry } from '../../domain/docs/templates.js';
import { parseFrontmatter } from '../../domain/skills/frontmatter.js';
import type { FileSystem } from '../../ports/fs.js';
import { teamSkills } from '../skill/observe.js';

export async function skillCatalog(fs: FileSystem, manifestDir: string): Promise<TeamSkillEntry[]> {
  const entries: TeamSkillEntry[] = [];
  for (const skill of await teamSkills(fs, manifestDir)) {
    const text = await fs.readText(path.join(skill.dir, 'SKILL.md'));
    const front = parseFrontmatter(text ?? '');
    entries.push({
      name: front.name ?? skill.name,
      description:
        front.description ?? 'No description provided; inspect this Skill before selecting it.',
      source: `skills/${skill.name}/SKILL.md`,
    });
  }
  return entries;
}
