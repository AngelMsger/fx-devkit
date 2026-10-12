// Whether the branches a release moves between agree in both directions, from
// people's commits alone; see "Merge agreement" in docs/design/release.md.

import type { Members } from '../manifest/types.js';
import { findByGitName } from '../members/resolve.js';
import type { Commit } from '../workspace/commits.js';

import {
  releaseFinding,
  type AttributedCommit,
  type Author,
  type ReleaseFinding,
  type Unmerged,
} from './types.js';

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
  const seen = [...(input.ahead.commits ?? []), ...(input.behind.commits ?? [])];
  const ahead = peopleCommits(input.ahead.commits ?? [], input.bots);
  const behind = peopleCommits(input.behind.commits ?? [], input.bots);
  const attribute = (c: Commit): AttributedCommit => attributed(input.members, c);
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
    ...(ahead.length === 0
      ? []
      : [`${count(ahead.length)} on ${source} not merged into ${target}`]),
    ...(behind.length === 0
      ? []
      : [`${count(behind.length)} on ${target} not merged back into ${source}`]),
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

// Merge commits and bot commits are noise on what changed; people's commits are the evidence.
export function peopleCommits(commits: readonly Commit[], bots: readonly string[]): Commit[] {
  const ignored = new Set(bots.map((b) => b.toLowerCase()));
  return commits.filter(
    (c) =>
      c.parents.length <= 1 &&
      !MERGE_SUBJECT.test(c.message) &&
      !ignored.has(c.author.toLowerCase()),
  );
}

export function attributed(members: Members | undefined, c: Commit): AttributedCommit {
  return { sha: c.sha, author: authorOf(members, c.author), date: c.date, message: c.message };
}

export function unmergedOf(commits: readonly AttributedCommit[]): Unmerged {
  return {
    commits: commits.length,
    authors: new Set(commits.map((c) => c.author.id ?? c.author.name)).size,
  };
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
