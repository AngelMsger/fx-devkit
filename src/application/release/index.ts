// Evaluate the release checklist in a fixed order, retaining failed or unavailable checks as findings.

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import { applyLocal, type ResolvedRepo } from '../../domain/manifest/local.js';
import { releasePolicyOf } from '../../domain/release/policy.js';
import {
  CHECKS,
  type Check,
  type ReleaseFinding,
  type ReleaseReport,
} from '../../domain/release/types.js';
import { windowMs } from '../../domain/release/window.js';
import { report } from '../../domain/report.js';
import { environmentsOf, envNotFound } from '../env/names.js';
import type { LoginDeps } from '../login/deps.js';
import { pooled } from '../pool.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { checkCi } from './ci.js';
import { checkDeps } from './deps.js';
import { checkErrors } from './errors.js';
import { gatherFacts, type CheckContext, type FactsOutcome } from './facts.js';
import { Gates } from './gates.js';
import { checkMerge } from './merge.js';

export interface ReleaseInput {
  readonly repos?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly only?: readonly Check[] | undefined;
  readonly env?: string | undefined;
  readonly since?: string | undefined;
  readonly jobs: number;
}

type Checker = (ctx: CheckContext, facts: FactsOutcome) => Promise<ReleaseFinding>;

const CHECKERS: Readonly<Record<Check, Checker>> = {
  deps: checkDeps,
  merge: checkMerge,
  ci: checkCi,
  errors: (ctx) => checkErrors(ctx),
};

export class Release {
  private readonly gates: Gates;

  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
  ) {
    this.gates = new Gates(deps, login);
  }

  async execute(input: ReleaseInput): Promise<ReleaseReport> {
    if (input.since !== undefined) windowMs(input.since);
    this.checkEnv(input.env);
    const checks = CHECKS.filter((c) => input.only === undefined || input.only.includes(c));
    const repos = this.select(input);
    await this.warmGates(repos, checks, input);
    const findings = await pooled(repos, input.jobs, (repo) => this.checkRepo(repo, checks, input));
    return report(CHECKS, findings.flat());
  }

  // A misspelled environment is answered here rather than as a warning on
  // every repository: the name came from the person, not from a platform.
  private checkEnv(env: string | undefined): void {
    if (env === undefined) return;
    const envs = environmentsOf(this.deps.ctx, this.deps.commandShell).envs;
    if (envs[env] === undefined) throw envNotFound(this.deps, env, Object.keys(envs));
  }

  // Readiness is judged before the pool starts and one gate at a time: a
  // tool's version probe has a short deadline that a machine busy with
  // thirty subprocesses would miss, turning a ready tool into "unknown".
  private async warmGates(
    repos: readonly ResolvedRepo[],
    checks: readonly Check[],
    input: ReleaseInput,
  ): Promise<void> {
    const doc = this.deps.ctx.manifest.workspace.result.doc;
    const policies = repos.map((repo) => releasePolicyOf(doc, repo.name));
    if (checks.some((c) => c !== 'errors')) await this.gates.through('code-host', undefined);
    const wanted = (check: Check, envs: (string | undefined)[]): string[] =>
      checks.includes(check) ? [...new Set(envs.filter((e): e is string => e !== undefined))] : [];
    for (const env of wanted(
      'ci',
      policies.flatMap((p) => [p.ci?.sourceEnv, p.ci?.targetEnv]),
    ))
      await this.gates.through('ci', env);
    for (const env of wanted(
      'errors',
      policies.map((p) => input.env ?? p.env),
    ))
      await this.gates.through('error-tracker', env);
  }

  // The checklist is the team's, so the shared registry is read without the
  // personal layer: what this machine picked or overrode does not change it.
  private select(input: ReleaseInput): readonly ResolvedRepo[] {
    const doc = this.deps.ctx.manifest.workspace.result.doc;
    const shared = applyLocal(doc, {}).repos;
    for (const name of input.repos ?? []) {
      if (!shared.some((r) => r.name === name))
        throw repoNotFound(
          name,
          shared.map((r) => r.name),
        );
    }
    const off = (input.repos ?? []).filter((name) => !releasePolicyOf(doc, name).covered);
    if (off.length > 0) throw notOnChecklist(off);
    const covered = shared.filter((repo) => releasePolicyOf(doc, repo.name).covered);
    const chosen = covered.filter(
      (repo) =>
        (input.repos === undefined || input.repos.includes(repo.name)) &&
        (input.tags === undefined || input.tags.some((t) => repo.tags.includes(t))),
    );
    if (chosen.length === 0) {
      if (input.tags !== undefined)
        throw tagNotFound(input.tags, [...new Set(covered.flatMap((r) => r.tags))]);
      throw emptyChecklist();
    }
    return chosen;
  }

  private async checkRepo(
    repo: ResolvedRepo,
    checks: readonly Check[],
    input: ReleaseInput,
  ): Promise<ReleaseFinding[]> {
    const shared = releasePolicyOf(this.deps.ctx.manifest.workspace.result.doc, repo.name);
    const ctx: CheckContext = {
      deps: this.deps,
      gates: this.gates,
      repo,
      policy: { ...shared, env: input.env ?? shared.env, since: input.since ?? shared.since },
      members: this.deps.ctx.manifest.members?.result.doc,
      now: this.login.clock.now(),
    };
    const facts = checks.some((c) => c !== 'errors')
      ? await gatherFacts(ctx)
      : { kind: 'error' as const, reason: 'not asked' };
    return Promise.all(checks.map((check) => CHECKERS[check](ctx, facts)));
  }
}

// The three ways a selection can name nothing. Each is an error rather than
// an empty report, because an empty report reads as a pass.
function emptyChecklist(): DevkitError {
  return new DevkitError(
    'not_found',
    'CHECKLIST_EMPTY',
    'No repository in this workspace is on the release checklist',
    {
      hint: 'A repository is on it unless its manifest entry says release.covered: false.',
      nextSteps: ['fx manifest lint', 'fx manifest explain repos[].release.covered'],
    },
  );
}

function tagNotFound(tags: readonly string[], known: readonly string[]): DevkitError {
  const suggestion = tags.map((t) => nearest(t, known)).find((s) => s !== undefined);
  return new DevkitError(
    'not_found',
    'TAG_NOT_FOUND',
    `No repository on the release checklist is tagged ${tags.map((t) => `"${t}"`).join(' or ')}`,
    {
      hint:
        suggestion === undefined
          ? `Tags in use: ${known.join(', ') || '(none)'}.`
          : `Did you mean "${suggestion}"?`,
      nextSteps: ['fx repo list --tag <tag>'],
    },
  );
}

function notOnChecklist(names: readonly string[]): DevkitError {
  return new DevkitError(
    'usage',
    'REPO_NOT_COVERED',
    `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} not on the release checklist`,
    {
      hint: 'A repository is on it unless its manifest entry says release.covered: false.',
      nextSteps: ['fx repo show <repo>', 'fx manifest explain repos[].release.covered'],
    },
  );
}

function repoNotFound(name: string, known: readonly string[]): DevkitError {
  const suggestion = nearest(name, known);
  return new DevkitError(
    'not_found',
    'REPO_NOT_FOUND',
    `No repository named "${name}" in this workspace`,
    {
      hint:
        suggestion === undefined
          ? 'fx repo list shows the known names.'
          : `Did you mean "${suggestion}"?`,
      nextSteps: ['fx repo list'],
    },
  );
}
