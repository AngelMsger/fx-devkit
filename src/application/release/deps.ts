// The first dependency file the source branch has, read from the host.

import { DEPENDENCY_FILES, depsFinding, scanDependencies } from '../../domain/release/deps.js';
import { unanswered, type ReleaseFinding } from '../../domain/release/types.js';

import { attempt, withoutFacts, type CheckContext, type FactsOutcome } from './facts.js';

export function checkDeps(ctx: CheckContext, outcome: FactsOutcome): Promise<ReleaseFinding> {
  const repo = ctx.repo.name;
  return attempt('deps', repo, async () => {
    if (outcome.kind !== 'facts') return withoutFacts('deps', repo, outcome);
    const { host, ref, source } = outcome.facts;
    if (source === undefined)
      return unanswered('deps', repo, `no branch ${ctx.policy.source ?? '(unset)'} on the host`);
    for (const { file } of DEPENDENCY_FILES) {
      const text = await host.readFile(ref, file, source.sha);
      if (text !== undefined) return depsFinding(repo, scanDependencies(file, text));
    }
    return depsFinding(repo, undefined);
  });
}
