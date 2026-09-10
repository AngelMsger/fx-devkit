// The branches a release moves between must agree in both directions: what
// the source has and the target lacks is unreleased work, what the target
// has and the source lacks is a hotfix nobody brought back. Merge commits
// and bot commits are noise on that question; people's commits are the
// evidence, attributed through the members document when it knows them.

import type { Members } from '../manifest/types.js';
import { findByGitName } from '../members/resolve.js';
import type { Commit } from '../workspace/commits.js';

import { releaseFinding, type ReleaseFinding } from './types.js';

export interface Author {
  readonly id: string | null;
  readonly name: string;
}

export interface AttributedCommit {
  readonly sha: string;
  readonly author: Author;
  readonly date: string;
  readonly message: string;
}

// One direction of the comparison: the commits, or why they are unknown.
export interface Direction {
  readonly commits: readonly Commit[] | undefined;
  readonly reason?: string | undefined;
}

export interface MergeInput {
  readonly repo: string;
  readonly source: string;
  readonly target: string;
  readonly ahead: Direction;
  readonly behind: Direction;
  readonly bots: readonly string[];
  readonly members: Members | undefined;
}

const MERGE_SUBJECT =
  /^(Merge pull request #|Pull request #|Merge branch |Merge remote-tracking branch )/;

export function judgeMerge(input: MergeInput): ReleaseFinding {
  const { repo, source, target } = input;
  const bots = new Set(input.bots.map((b) => b.toLowerCase()));
  const keep = (c: Commit): boolean =>
    c.parents.length <= 1 && !MERGE_SUBJECT.test(c.message) && !bots.has(c.author.toLowerCase());
  const seen = [...(input.ahead.commits ?? []), ...(input.behind.commits ?? [])];
  const ahead = (input.ahead.commits ?? []).filter(keep);
  const behind = (input.behind.commits ?? []).filter(keep);
  const attribute = (c: Commit): AttributedCommit => ({
    sha: c.sha,
    author: authorOf(input.members, c.author),
    date: c.date,
    message: c.message,
  });
  const unknown = [
    ...(input.ahead.commits === undefined ? [`${target}..${source}`] : []),
    ...(input.behind.commits === undefined ? [`${source}..${target}`] : []),
  ];
  const evidence = {
    source,
    target,
    ahead: ahead.map(attribute),
    behind: behind.map(attribute),
    filtered: seen.length - ahead.length - behind.length,
    unknown,
  };
  const diverged = [
    ...(ahead.length === 0 ? [] : [`${count(ahead.length)} on ${source} not on ${target}`]),
    ...(behind.length === 0 ? [] : [`${count(behind.length)} on ${target} not on ${source}`]),
  ];
  // A direction nobody could compare does not undo what the other one saw.
  const unanswered = unknown.map((range, i) => `could not compare ${range}: ${reasonOf(input, i)}`);
  if (diverged.length > 0)
    return releaseFinding('merge', repo, 'fail', [...diverged, ...unanswered].join(', and '), {
      evidence,
      coverage: unknown.length > 0 ? 'incomplete' : 'checked',
    });
  if (unanswered.length > 0)
    return releaseFinding('merge', repo, 'warn', unanswered.join(', and '), {
      evidence,
      coverage: 'incomplete',
    });
  return releaseFinding('merge', repo, 'ok', `${source} and ${target} agree`, { evidence });
}

function reasonOf(input: MergeInput, index: number): string {
  const reasons = [
    ...(input.ahead.commits === undefined ? [input.ahead.reason] : []),
    ...(input.behind.commits === undefined ? [input.behind.reason] : []),
  ];
  return reasons[index] ?? 'no reason given';
}

function authorOf(members: Members | undefined, name: string): Author {
  const person = members === undefined ? undefined : findByGitName(members, name);
  return person === undefined
    ? { id: null, name }
    : { id: person.id, name: person.display ?? person.id };
}

function count(n: number): string {
  return `${n} commit${n === 1 ? '' : 's'}`;
}
