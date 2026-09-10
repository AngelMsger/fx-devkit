import { describe, expect, it } from 'vitest';

import { lintSkill } from '../../../../src/domain/skills/lint.js';

describe('lintSkill', () => {
  it('passes a Skill whose frontmatter names its directory and describes itself', () => {
    expect(lintSkill('review', '---\nname: review\ndescription: Review a change\n---\n')).toEqual(
      [],
    );
  });

  it('wants a SKILL.md, the directory name, and a description', () => {
    expect(lintSkill('review', undefined).map((f) => f.code)).toEqual(['SKILL_WITHOUT_SKILL_MD']);
    expect(lintSkill('review', '---\nname: reviewer\ndescription: x\n---\n')).toEqual([
      {
        kind: 'skills',
        code: 'SKILL_NAME_MISMATCH',
        path: 'skills/review/SKILL.md',
        message: 'frontmatter name is "reviewer"; agents expect the directory name, review',
      },
    ]);
    expect(lintSkill('review', '# no frontmatter\n').map((f) => f.code)).toEqual([
      'SKILL_NAME_MISMATCH',
      'SKILL_WITHOUT_DESCRIPTION',
    ]);
  });
});
