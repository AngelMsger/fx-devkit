import { describe, expect, it } from 'vitest';

import { selectContributionFiles } from '../../../../src/domain/contribution/selection.js';

const changes = [
  {
    path: 'skills/a/SKILL.md',
    kind: 'file' as const,
    mode: '100644' as const,
    content: 'selected',
  },
  {
    path: 'skills-extra/b.md',
    kind: 'file' as const,
    mode: '100644' as const,
    content: 'unselected',
  },
  {
    path: 'workspace.yaml',
    kind: 'file' as const,
    mode: '100644' as const,
    content: 'staged elsewhere',
  },
];

describe('contribution file selection', () => {
  it('expands a directory at path boundaries and excludes unrelated staged changes', () => {
    expect(selectContributionFiles({ paths: ['skills'], changes })).toEqual([changes[0]]);
  });

  it('deduplicates overlapping selections in deterministic order', () => {
    const selected = selectContributionFiles({
      paths: ['workspace.yaml', 'skills', 'skills/a/SKILL.md'],
      changes,
    });
    expect(selected.map((file) => file.path)).toEqual(['skills/a/SKILL.md', 'workspace.yaml']);
  });

  it('requires an explicit selection', () => {
    expect(() => selectContributionFiles({ paths: [], changes })).toThrow(
      expect.objectContaining({ code: 'INPUT_REQUIRED' }),
    );
  });

  it.each([
    '../secret',
    '/tmp/secret',
    'a/../secret',
    '.git/config',
    'x/.git/file',
    'C:/secret',
    'a\\b',
    'a\0b',
    ':(glob)**',
  ])('rejects unsafe selection %s', (path) => {
    expect(() => selectContributionFiles({ paths: [path], changes })).toThrow(
      expect.objectContaining({ code: 'SOURCE_PATH_INVALID' }),
    );
  });

  it('suggests a mistyped changed source path', () => {
    expect(() => selectContributionFiles({ paths: ['skils/a/SKILL.md'], changes })).toThrow(
      expect.objectContaining({
        code: 'SOURCE_SELECTION_EMPTY',
        hint: 'Did you mean "skills/a/SKILL.md"?',
      }),
    );
  });
  it('reports a selection that matches no changed file', () => {
    expect(() => selectContributionFiles({ paths: ['unknown'], changes })).toThrow(
      expect.objectContaining({ code: 'SOURCE_SELECTION_EMPTY' }),
    );
  });

  it.each(['symlink', 'gitlink'] as const)('refuses selected %s entries', (kind) => {
    expect(() =>
      selectContributionFiles({
        paths: ['entry'],
        changes: [{ path: 'entry', kind, mode: '100644', content: 'opaque' }],
      }),
    ).toThrow(expect.objectContaining({ code: 'SOURCE_ENTRY_UNSUPPORTED' }));
  });

  it('requires both sides of a rename and preserves deletion explicitly', () => {
    const renamed = [
      {
        path: 'old.md',
        kind: 'deleted' as const,
        mode: '100644' as const,
        content: null,
        renamePeer: 'new.md',
      },
      {
        path: 'new.md',
        kind: 'file' as const,
        mode: '100755' as const,
        content: 'new',
        renamePeer: 'old.md',
      },
    ];
    expect(() => selectContributionFiles({ paths: ['new.md'], changes: renamed })).toThrow(
      expect.objectContaining({ code: 'SOURCE_RENAME_INCOMPLETE' }),
    );
    expect(selectContributionFiles({ paths: ['old.md', 'new.md'], changes: renamed })).toEqual([
      renamed[1],
      renamed[0],
    ]);
  });
});
