import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../../../../src/domain/skills/frontmatter.js';
import { decideCopy, decideLink } from '../../../../src/domain/skills/projection.js';

const wanted = '/fake/.fx/workspaces/fx/source/skills';

describe('decideLink', () => {
  it('creates a link where nothing is, and leaves a correct fx link alone', () => {
    expect(decideLink({ kind: 'absent' }, wanted, true)).toEqual({ action: 'create' });
    expect(decideLink({ kind: 'link', target: wanted }, wanted, true)).toEqual({
      action: 'unchanged',
    });
    expect(decideLink({ kind: 'link', target: `${wanted}/../skills` }, wanted, true)).toEqual({
      action: 'unchanged',
    });
  });

  it('prunes an fx link whose source vanished', () => {
    expect(decideLink({ kind: 'link', target: wanted }, wanted, false)).toEqual({
      action: 'prune',
    });
  });

  it('never touches a real directory, a file, or a link that points elsewhere', () => {
    expect(decideLink({ kind: 'directory' }, wanted, true)).toMatchObject({ action: 'foreign' });
    expect(decideLink({ kind: 'file' }, wanted, true)).toMatchObject({ action: 'foreign' });
    for (const target of [
      '/home/me/my-skills',
      `${wanted}/review`,
      '/fake/.fx/workspaces/old/source/skills',
    ])
      expect(decideLink({ kind: 'link', target }, wanted, true)).toMatchObject({
        action: 'foreign',
        reason: expect.stringContaining(target),
      });
  });

  it('does nothing when there is neither a source nor a link', () => {
    expect(decideLink({ kind: 'absent' }, wanted, false)).toEqual({ action: 'skip' });
  });
});

describe('decideCopy', () => {
  it('installs, upgrades an older copy, keeps a current one, and refuses a foreign directory', () => {
    expect(decideCopy({ kind: 'absent' }, '1.2.0')).toBe('install');
    expect(decideCopy({ kind: 'ours', version: '1.1.0' }, '1.2.0')).toBe('upgrade');
    expect(decideCopy({ kind: 'ours', version: '1.2.0' }, '1.2.0')).toBe('unchanged');
    expect(decideCopy({ kind: 'ours', version: '2.0.0' }, '1.2.0')).toBe('unchanged');
    expect(decideCopy({ kind: 'foreign' }, '1.2.0')).toBe('foreign');
  });
});

describe('parseFrontmatter', () => {
  it('reads name, version and description from the leading block only', () => {
    const text = [
      '---',
      'name: fx-workspace',
      'version: 0.3.0',
      "description: 'Use when ...'",
      '---',
      '',
      'version: 9.9.9 (in the body, ignored)',
    ].join('\n');
    expect(parseFrontmatter(text)).toEqual({
      name: 'fx-workspace',
      version: '0.3.0',
      description: 'Use when ...',
    });
    expect(parseFrontmatter('no frontmatter')).toEqual({});
  });
});
