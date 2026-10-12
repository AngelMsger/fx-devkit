// The error tracker of the release environment, at the repository's
// coordinate there; a repository without one is not checked, and says so.

import { locateRepo } from '../../domain/obs/coordinate.js';
import { errorsFinding, ISSUE_CEILING } from '../../domain/release/errors.js';
import { notChecked, unanswered, type ReleaseFinding } from '../../domain/release/types.js';
import type { ErrorTracker } from '../../ports/error-tracker.js';
import { environmentsOf } from '../env/names.js';
import { platformAs } from '../workspace/platforms.js';

import { attempt, type CheckContext } from './facts.js';
import { blockedFinding } from './gates.js';

export function checkErrors(ctx: CheckContext): Promise<ReleaseFinding> {
  const repo = ctx.repo.name;
  return attempt('errors', repo, async () => {
    const env = ctx.policy.env;
    if (env === undefined)
      return notChecked('errors', repo, 'no environment for errors in the release policy');
    const gate = await ctx.gates.through('error-tracker', env);
    if (!gate.open) return blockedFinding('errors', repo, gate);
    const tracker = platformAs<ErrorTracker>(ctx.deps, 'error-tracker', 'issues', env);
    if (tracker.platform === undefined) return unanswered('errors', repo, tracker.reason);
    const coordinate = locateRepo({
      repo: ctx.repo,
      env,
      platform: tracker.binding.platform,
      environments: environmentsOf(ctx.deps.ctx),
      binding: tracker.binding,
      locate: (vars) => tracker.platform.locate(vars),
    });
    if (coordinate.status === 'not_covered')
      return notChecked(
        'errors',
        repo,
        coordinate.notes[0] ?? `no ${tracker.binding.platform} coordinate in ${env}`,
      );
    const page = await tracker.platform.issues(coordinate.vars, {
      since: ctx.policy.since,
      limit: ISSUE_CEILING,
    });
    return errorsFinding({
      repo,
      env,
      // What a person reads is the platform's own name for the project; `slug` stays in
      // the evidence for the programs that already read it.
      slug: coordinate.vars['slug'] ?? coordinate.label,
      label: coordinate.label,
      since: ctx.policy.since,
      now: ctx.now,
      issues: page.issues,
      capped: page.more,
    });
  });
}
