import { describe, expect, it } from 'vitest';

import { projectIndex } from '../../../../src/domain/docs/templates.js';
import { repoSchema } from '../../../../src/domain/manifest/workspace.schema.js';

describe('repository metadata', () => {
  it('does not add aliases or links to the resident project index', () => {
    const base = {
      schema_version: 2,
      defaults: {},
      repos: [{ name: 'backend', desc: 'Backend service' }],
    };
    expect(
      projectIndex({
        ...base,
        repos: [{ ...base.repos[0]!, aka: ['platform'], links: { guide: 'docs/design.md' } }],
      }),
    ).toBe(projectIndex(base));
  });

  it('accepts aliases and named references without treating references as URLs', () => {
    const repo = {
      name: 'backend',
      aka: ['platform', '平台'],
      links: { design: 'docs/design.md', upstreamGuide: 'https://docs.example.com/guide' },
    };
    expect(repoSchema.parse(repo)).toEqual(repo);
    expect(repoSchema.parse({ name: 'backend' })).toEqual({ name: 'backend' });
  });

  it.each([
    { metadata: { aka: 'alias' }, at: ['aka'] },
    { metadata: { aka: [1] }, at: ['aka', 0] },
    { metadata: { aka: [''] }, at: ['aka', 0] },
    { metadata: { aka: [' '] }, at: ['aka', 0] },
    { metadata: { links: ['guide'] }, at: ['links'] },
    { metadata: { links: { guide: 1 } }, at: ['links', 'guide'] },
    { metadata: { links: { '': 'guide' } }, at: ['links', ''] },
  ])('rejects invalid metadata instead of coercing it: $metadata', ({ metadata, at }) => {
    const result = repoSchema.safeParse({ name: 'backend', ...metadata });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([at]);
  });
});
