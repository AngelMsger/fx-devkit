// Pending contributions retain intent across uncertain remote responses. Only
// authoritative absence or closure permits retiring a record automatically.

export interface PendingContribution {
  readonly id: string;
  readonly remoteIdentity: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly commit: string | null;
  readonly tree: string;
  readonly files: readonly string[];
  readonly phase: 'prepared' | 'committed' | 'pushed' | 'creating_pr' | 'open';
  readonly pullRequest: string | null;
  readonly updatedAt: string;
}

interface ContributionReuse {
  readonly pending: PendingContribution | null;
  readonly remoteIdentity: string;
  readonly files: readonly string[];
  readonly tree: string;
  // null is confirmed absent; undefined means the query could not answer.
  readonly remoteHead: string | null | undefined;
  readonly pullRequestState: 'open' | 'closed' | 'unknown';
  readonly forceNew: boolean;
}

export function decideContributionReuse(
  input: ContributionReuse,
): 'new' | 'reuse' | 'unchanged' | 'recover' | 'conflict' {
  const pending = input.pending;
  if (input.forceNew || pending === null || pending.remoteIdentity !== input.remoteIdentity)
    return 'new';
  if (pending.phase !== 'open') return 'recover';
  if (input.pullRequestState === 'closed' || input.remoteHead === null) return 'new';
  if (input.pullRequestState === 'unknown' || input.remoteHead === undefined) return 'recover';
  const selected = new Set(input.files);
  if (!pending.files.every((file) => selected.has(file))) return 'new';
  if (input.remoteHead !== pending.commit) return 'conflict';
  return input.tree === pending.tree ? 'unchanged' : 'reuse';
}
