import { describe, expect, it } from 'vitest';

import {
  decideContributionReuse,
  type PendingContribution,
} from '../../../../src/domain/contribution/pending.js';

const pending: PendingContribution = {
  id: 'operation',
  remoteIdentity: 'identity',
  branch: 'fx/contribution/operation',
  baseBranch: 'main',
  commit: 'commit-a',
  tree: 'tree-a',
  files: ['a.md', 'b.md'],
  phase: 'open',
  pullRequest: 'https://example.com/pr/1',
  updatedAt: '2026-09-09T00:00:00Z',
};
const base = {
  pending,
  remoteIdentity: 'identity',
  files: ['a.md', 'b.md'],
  tree: 'tree-b',
  remoteHead: 'commit-a',
  pullRequestState: 'open' as const,
  forceNew: false,
};

describe('pending contribution reuse', () => {
  it('reuses only when selection covers every previous file', () => {
    expect(decideContributionReuse(base)).toBe('reuse');
    expect(decideContributionReuse({ ...base, files: ['a.md'] })).toBe('new');
    expect(decideContributionReuse({ ...base, files: ['a.md', 'b.md', 'c.md'] })).toBe('reuse');
  });
  it('skips unchanged trees only after the remote commit is confirmed', () => {
    expect(decideContributionReuse({ ...base, tree: 'tree-a' })).toBe('unchanged');
    expect(decideContributionReuse({ ...base, tree: 'tree-a', remoteHead: 'other' })).toBe(
      'conflict',
    );
  });
  it('preserves uncertain remote state for recovery instead of replacing it', () => {
    expect(decideContributionReuse({ ...base, remoteHead: undefined })).toBe('recover');
    expect(decideContributionReuse({ ...base, pullRequestState: 'unknown' })).toBe('recover');
    expect(
      decideContributionReuse({
        ...base,
        pending: { ...pending, phase: 'creating_pr', pullRequest: null },
      }),
    ).toBe('recover');
  });
  it('starts anew after authoritative closure or branch absence', () => {
    expect(decideContributionReuse({ ...base, pullRequestState: 'closed' })).toBe('new');
    expect(decideContributionReuse({ ...base, remoteHead: null })).toBe('new');
  });
  it('does not reuse another remote or an explicitly replaced operation', () => {
    expect(decideContributionReuse({ ...base, remoteIdentity: 'different' })).toBe('new');
    expect(decideContributionReuse({ ...base, forceNew: true })).toBe('new');
    expect(decideContributionReuse({ ...base, pending: null })).toBe('new');
  });
});
