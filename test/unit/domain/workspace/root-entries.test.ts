import { describe, expect, it } from 'vitest';

import {
  accountedNames,
  isStray,
  strayDigest,
  WORKBENCH_DIR,
} from '../../../../src/domain/workspace/root-entries.js';

describe('root entries', () => {
  it('accounts for the first segment of every path, and for the workbench without being told', () => {
    const accounted = accountedNames([
      'group/nested-repo',
      './api',
      '.claude/skills',
      '../outside',
    ]);
    expect([...accounted].sort()).toEqual([WORKBENCH_DIR, '.claude', 'api', 'group'].sort());
  });

  it('treats hidden entries like any other, apart from operating-system and editor state', () => {
    const accounted = accountedNames(['api']);
    expect(['.worktrees', '.log', 'notes', 'demo.html'].every((n) => isStray(n, accounted))).toBe(
      true,
    );
    expect(
      ['api', WORKBENCH_DIR, '.DS_Store', '.vscode', '.idea', 'team.code-workspace'].some((n) =>
        isStray(n, accounted),
      ),
    ).toBe(false);
  });

  it('keeps the digest to one bounded line however many entries or however long their names', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      name: `${'report-'.repeat(20)}${i}\nsecond line`,
      kind: 'file' as const,
    }));
    const digest = strayDigest(entries);
    expect(digest.startsWith(`12 outside ${WORKBENCH_DIR}: `)).toBe(true);
    expect(digest.endsWith(', and 7 more')).toBe(true);
    expect(digest).not.toContain('\n');
    expect(digest.length).toBeLessThan(200);
  });
});
