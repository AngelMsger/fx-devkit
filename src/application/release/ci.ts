// The source job and the target job, each located through the manifest's
// ci coordinate for its environment, each compared with its branch head.

import { asDevkitError } from '../../domain/errors.js';
import { locateRepo } from '../../domain/obs/coordinate.js';
import { ciFinding, type BuildSide } from '../../domain/release/ci.js';
import { notChecked, type ReleaseFinding } from '../../domain/release/types.js';
import type { Branch } from '../../domain/workspace/commits.js';
import type { Ci } from '../../ports/ci.js';
import { environmentsOf } from '../env/names.js';
import { platformAs } from '../workspace/platforms.js';

import {
  attempt,
  withoutFacts,
  type CheckContext,
  type FactsOutcome,
  type RepoFacts,
} from './facts.js';

export function checkCi(ctx: CheckContext, outcome: FactsOutcome): Promise<ReleaseFinding> {
  const repo = ctx.repo.name;
  return attempt('ci', repo, async () => {
    const envs = ctx.policy.ci;
    if (envs === undefined)
      return notChecked('ci', repo, 'no ci environments in the release policy');
    if (outcome.kind !== 'facts') return withoutFacts('ci', repo, outcome);
    const { facts } = outcome;
    const sides = await Promise.all([
      side(ctx, facts, 'source', facts.source, envs.sourceEnv),
      side(ctx, facts, 'target', facts.target, envs.targetEnv),
    ]);
    if (sides.every((s) => s.path === null && s.reason === undefined))
      return notChecked('ci', repo, `no ci coordinate in ${envs.sourceEnv} or ${envs.targetEnv}`);
    return ciFinding(repo, sides);
  });
}

// One side: its own environment's gate, its own environment's platform, its
// own two queries. Nothing it fails to learn takes down what the other side
// found.
async function side(
  ctx: CheckContext,
  facts: RepoFacts,
  which: BuildSide['side'],
  branch: Branch | undefined,
  env: string,
): Promise<BuildSide> {
  const blank = {
    side: which,
    env,
    branch: branch?.name,
    sha: branch?.sha ?? null,
    build: undefined,
    head: null,
  };
  if (branch === undefined) return { ...blank, path: null };
  const gate = await ctx.gates.through('ci', env);
  if (!gate.open) return { ...blank, path: null, reason: gate.reason };
  const ci = platformAs<Ci>(ctx.deps, 'ci', 'lastBuild', env);
  if (ci.platform === undefined) return { ...blank, path: null, reason: ci.reason };
  const coordinate = locateRepo({
    repo: ctx.repo,
    env,
    platform: ci.binding.platform,
    environments: environmentsOf(ctx.deps.ctx),
    binding: ci.binding,
    locate: (vars) => ci.platform.locate(vars),
  });
  if (coordinate.status === 'not_covered') return { ...blank, path: null };
  // What a person reads is the platform's own name for the job; `path` stays in the
  // evidence for the programs that already read it.
  const job = coordinate.label;
  const path = coordinate.vars['path'] ?? job;
  const [build, head] = await Promise.all([
    settled(() => ci.platform.lastBuild(coordinate.vars)),
    settled(() => facts.host.commit(facts.ref, branch.sha)),
  ]);
  if (build.reason !== undefined) return { ...blank, path, job, reason: build.reason };
  return { ...blank, path, job, build: build.value, head: head.value?.date ?? null };
}

// A query's own outcome, so two of them can be told apart afterwards.
async function settled<T>(
  run: () => Promise<T>,
): Promise<{ value?: T; reason?: string | undefined }> {
  try {
    return { value: await run() };
  } catch (err) {
    return { reason: asDevkitError(err).message };
  }
}
