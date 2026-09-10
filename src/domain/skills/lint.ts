// Advice about a team Skill in the manifest repository: what an agent needs
// in order to find it and choose it. Nothing here blocks a sync.

import type { LintFinding } from '../manifest/lint.js';

import { parseFrontmatter } from './frontmatter.js';

export function lintSkill(name: string, skillMd: string | undefined): LintFinding[] {
  const finding = (code: string, message: string): LintFinding => ({
    kind: 'skills',
    code,
    path: `skills/${name}/SKILL.md`,
    message,
  });
  if (skillMd === undefined)
    return [
      finding(
        'SKILL_WITHOUT_SKILL_MD',
        'a Skill directory needs a SKILL.md; agents ignore it otherwise',
      ),
    ];
  const front = parseFrontmatter(skillMd);
  const findings: LintFinding[] = [];
  if (front.name !== name) {
    const actual = front.name === undefined ? 'is missing' : `is "${front.name}"`;
    findings.push(
      finding(
        'SKILL_NAME_MISMATCH',
        `frontmatter name ${actual}; agents expect the directory name, ${name}`,
      ),
    );
  }
  if (front.description === undefined)
    findings.push(
      finding(
        'SKILL_WITHOUT_DESCRIPTION',
        'frontmatter has no description; agents choose a Skill by it',
      ),
    );
  return findings;
}
