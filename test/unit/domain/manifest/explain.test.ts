import { describe, expect, it } from 'vitest';

import { describePath } from '../../../../src/domain/manifest/explain.js';

describe('describePath', () => {
  it('treats repos[3].branch, repos[].branch and repos.branch as the same field', () => {
    const spellings = ['repos[3].branch', 'repos[].branch', 'repos.branch'];
    const docs = spellings.map((p) => describePath('workspace', p));
    for (const doc of docs) {
      expect(doc).toMatchObject({
        path: 'repos[].branch',
        type: 'string',
        required: false,
        description: expect.stringContaining('defaults.branch'),
        children: [],
      });
    }
  });

  it('descends through maps and reports an object field with its children', () => {
    const doc = describePath('environments', 'envs.platforms');
    expect(doc.type).toMatch(/^map of/);
    expect(doc.children).toEqual(['vars', 'confidence', 'note', 'observations', 'setup']);
    expect(describePath('workspace', 'repos[].obs.overrides').type).toBe('map of map of object');
  });

  it('describes the root when no path is given', () => {
    const root = describePath('tools', undefined);
    expect(root.path).toBe('(root)');
    expect(root.required).toBe(true);
    expect(root.children).toEqual(['schema_version', 'min_cli', 'defaults', 'tools']);
    expect(root.description).toContain('toolchain');
  });

  it('shows the alternatives of a union field', () => {
    expect(describePath('tools', 'tools[].setup[].verify').type).toBe('object | object | object');
    expect(describePath('members', 'people[].accounts').type).toBe('map of string | object');
  });

  it('rejects an unknown path with a suggestion from the same level and kind', () => {
    expect(() => describePath('workspace', 'repos[].brnch')).toThrow(
      expect.objectContaining({
        category: 'usage',
        code: 'UNKNOWN_MANIFEST_FIELD',
        hint: expect.stringContaining('repos[].branch'),
      }),
    );
    expect(() => describePath('tools', 'repos')).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_MANIFEST_FIELD' }),
    );
  });
});
