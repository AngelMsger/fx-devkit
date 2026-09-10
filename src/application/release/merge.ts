// Both directions between source and target, folded into one finding.

import { asDevkitError } from '../../domain/errors.js';
import { judgeMerge, type Direction } from '../../domain/release/merge.js';
import { notChecked, unanswered, type ReleaseFinding } from '../../domain/release/types.js';

import {
  attempt,
  withoutFacts,
  type CheckContext,
  type FactsOutcome,
  type RepoFacts,
} from './facts.js';

export function checkMerge(ctx: CheckContext, outcome: FactsOutcome): Promise<ReleaseFinding> {
  const repo = ctx.repo.name;
  return attempt('merge', repo, async () => {
    if (outcome.kind !== 'facts') return withoutFacts('merge', repo, outcome);
    const { host, ref, source, target } = outcome.facts;
    if (source === undefined)
      return unanswered('merge', repo, `no branch ${ctx.policy.source ?? '(unset)'} on the host`);
    if (target === undefined)
      return notChecked('merge', repo, `one branch, no ${ctx.policy.targets.join(' or ')}`);
    const [ahead, behind] = await Promise.all([
      between(host, ref, target.sha, source.sha),
      between(host, ref, source.sha, target.sha),
    ]);
    return judgeMerge({
      repo,
      source: source.name,
      target: target.name,
      ahead,
      behind,
      bots: ctx.policy.bots,
      members: ctx.members,
    });
  });
}

// One direction, answering for itself: a comparison that fails must not
// take the other direction's verdict down with it.
async function between(
  host: RepoFacts['host'],
  ref: RepoFacts['ref'],
  from: string,
  to: string,
): Promise<Direction> {
  try {
    return { commits: await host.compare(ref, { from, to }) };
  } catch (err) {
    return { commits: undefined, reason: asDevkitError(err).message };
  }
}
