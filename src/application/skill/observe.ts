// Looking at one Skill location through the FileSystem port, for the
// domain's decision functions.

import path from 'node:path';

import { parseFrontmatter } from '../../domain/skills/frontmatter.js';
import type { CopyObservation, LinkObservation } from '../../domain/skills/projection.js';
import type { FileSystem } from '../../ports/fs.js';

export const FX_SKILL = 'fx-workspace';

export async function observeLink(fs: FileSystem, at: string): Promise<LinkObservation> {
  const target = await fs.readLink(at);
  // A relative target is relative to the link's own directory; resolving it
  // against anything else could misclassify a foreign link as fx's.
  if (target !== undefined) return { kind: 'link', target: path.resolve(path.dirname(at), target) };
  if (!(await fs.exists(at))) return { kind: 'absent' };
  return (await fs.isDirectory(at)) ? { kind: 'directory' } : { kind: 'file' };
}

export async function observeCopy(fs: FileSystem, at: string): Promise<CopyObservation> {
  if ((await fs.readLink(at)) !== undefined) return { kind: 'foreign' };
  if (!(await fs.exists(at))) return { kind: 'absent' };
  if (!(await fs.isDirectory(at))) return { kind: 'foreign' };
  const text = await fs.readText(path.join(at, 'SKILL.md'));
  const front = text === undefined ? {} : parseFrontmatter(text);
  if (front.name === FX_SKILL && front.version !== undefined)
    return { kind: 'ours', version: front.version };
  return { kind: 'foreign' };
}

// Team Skills live in the manifest source; a link is fx's only when it points
// at this directory.
export function teamSkillsRoot(manifestDir: string): string {
  return path.join(manifestDir, 'skills');
}

// Every child of the Skills root that carries a SKILL.md.
export async function teamSkills(
  fs: FileSystem,
  manifestDir: string,
): Promise<{ name: string; dir: string }[]> {
  const base = teamSkillsRoot(manifestDir);
  const found: { name: string; dir: string }[] = [];
  for (const name of (await fs.readDir(base)).sort()) {
    const dir = path.join(base, name);
    if (await fs.exists(path.join(dir, 'SKILL.md'))) found.push({ name, dir });
  }
  return found;
}
