import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isAtOrInside, isPlainRelativePath } from '../../../src/domain/path.js';

describe('isAtOrInside', () => {
  it('tells a child, the directory itself, a sibling and a parent step apart', () => {
    expect(isAtOrInside('/ws/fx', '/ws/fx')).toBe(true);
    expect(isAtOrInside('/ws/fx/src', '/ws/fx')).toBe(true);
    expect(isAtOrInside('/ws/fx/..draft/out.yaml', '/ws/fx')).toBe(true);
    expect(isAtOrInside('/ws/fxtra', '/ws/fx')).toBe(false);
    expect(isAtOrInside('/ws', '/ws/fx')).toBe(false);
    expect(isAtOrInside('/ws/fx/../other', '/ws/fx')).toBe(false);
    expect(isAtOrInside(path.resolve('/elsewhere'), '/ws/fx')).toBe(false);
  });
});

describe('isPlainRelativePath', () => {
  it.each(['a.md', 'docs/guide/a.md', '.mcp.json', '.github/workflows/ci.yml', '..draft/a.md'])(
    'accepts %j',
    (value) => {
      expect(isPlainRelativePath(value)).toBe(true);
    },
  );

  it.each([
    '',
    '/etc/passwd',
    'docs//a.md',
    'docs/',
    './a.md',
    'docs/./a.md',
    '../a.md',
    'docs/..',
    '.git/config',
    'vendor/.GIT/config',
    'docs\\a.md',
    'C:/a.md',
    'a\nb.md',
    'a\x7fb.md',
  ])('refuses %j', (value) => {
    expect(isPlainRelativePath(value)).toBe(false);
  });
});
