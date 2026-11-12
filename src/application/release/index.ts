// Evaluate the release checklist, retaining failed or unavailable checks as findings,
// beside what each repository's release would carry. Checks run concurrently; the
// fixed order is the report's, not the execution's.
// Selection and gate warming follow docs/design/release.md, "Selection and order".

import { DevkitError } from '../../domain/errors.js';
import { nearest, suggestionHint } from '../../domain/fuzzy.js';
import { applyLocal, type ResolvedRepo } from '../../domain/manifest/local.js';
import { releasePolicyOf } from '../../domain/release/policy.js';
import {
  CHECKS,
  type Check,
  type ReleaseFinding,
  type ReleaseRepo,
  type ReleaseReport,
} from '../../domain/release/types.js';
import { resolveRange, type TimeRange } from '../../domain/release/window.js';
import { report } from '../../domain/report.js';
import { environmentsOf, envNotFound } from '../env/names.js';
import type { LoginDeps } from '../login/deps.js';
import { pooled } from '../pool.js';
import { Tally } from '../tally.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceItemNotFound } from '../workspace/guidance.js';

import { checkCi } from './ci.js';
import { checkDeps } from './deps.js';
import { checkErrors } from './errors.js';
import { gatherFacts, type CheckContext, type FactsOutcome } from './facts.js';
import { Gates } from './gates.js';
import { checkMerge } from './merge.js';
import { describeRepo } from './repo.js';
import { validateVersionPath } from './version-declaration.js';

export interface ReleaseInput {
  readonly repos?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly only?: readonly Check[] | undefined;
  readonly env?: string | undefined;
  readonly since?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly versionHistory?: boolean | undefined;
  readonly versionPaths?: Readonly<Record<string, string>> | undefined;
  readonly baselines?: Readonly<Record<string, string>> | undefined;
  readonly historyLimit?: number | undefined;
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
    const observedAt = this.login.clock.now();
    this.checkEnv(input.env);
    const checks = CHECKS.filter((c) => input.only === undefined || input.only.includes(c));
    const repos = this.select(input);
    this.validateEvidenceInput(input, repos, observedAt);
    await this.warmGates(repos, checks, input);
    const results = await Tally.during(this.deps.activity, 'repos', (tally) => {
      tally.plan(repos.length);
      return pooled(repos, input.jobs, (repo) =>
        tally.unit(repo.name, () => this.checkRepo(repo, checks, input, observedAt)),
      );
    });
    const checked = report(
      CHECKS,
      results.flatMap((r) => r.findings),
    );
    const described = results.map((r) => r.repo);
    return {
      ...checked,
      repos: described,
      observed_at: observedAt.toISOString(),
      range: commonRange(described),
      evidence_complete:
        checked.complete &&
        described.every(
          (repo) =>
            repo.unanswered.length === 0 &&
            Object.values(repo.facet_coverage ?? {}).every((coverage) => coverage !== 'incomplete'),
        ),
    };
  }

  private validateEvidenceInput(
    input: ReleaseInput,
    repos: readonly ResolvedRepo[],
    now: Date,
  ): void {
    const names = new Set(repos.map((repo) => repo.name));
    for (const [kind, values] of Object.entries({
      baseline: input.baselines,
      'version-path': input.versionPaths,
    })) {
      for (const [name, value] of Object.entries(values ?? {})) {
        if (!names.has(name) || value.trim() === '')
          throw new DevkitError(
            'usage',
            'RELEASE_OVERRIDE_INVALID',
            `The ${kind} override must name a selected repository and a nonempty value`,
            {
              nextSteps: ['Select the repository and provide a repo=value override.'],
            },
          );
      }
    }
    for (const value of Object.values(input.versionPaths ?? {})) validateVersionPath(value);
    if (
      input.historyLimit !== undefined &&
      (!Number.isSafeInteger(input.historyLimit) ||
        input.historyLimit < 1 ||
        input.historyLimit > 1000)
    )
      throw new DevkitError(
        'usage',
        'VERSION_HISTORY_BUDGET_INVALID',
        'History budget must be between 1 and 1000 commits',
        {
          nextSteps: ['Use --history-limit with an integer from 1 to 1000.'],
        },
      );
    for (const repo of repos) this.rangeFor(repo, input, now);
  }

  private rangeFor(repo: ResolvedRepo, input: ReleaseInput, now: Date): TimeRange {
    const policy = releasePolicyOf(this.deps.ctx.manifest.workspace.result.doc, repo.name);
    const explicit = input.from !== undefined || input.to !== undefined;
    const since = input.since ?? (explicit ? undefined : policy.since);
    return resolveRange(
      {
        ...(since === undefined ? {} : { since }),
        ...(input.from === undefined ? {} : { start: input.from }),
        ...(input.to === undefined ? {} : { end: input.to }),
      },
      now,
    );
  }

  // The name came from the person, so it is answered once, not per repository.
  private checkEnv(env: string | undefined): void {
    if (env === undefined) return;
    const envs = environmentsOf(this.deps.ctx, this.deps.commandShell).envs;
    if (envs[env] === undefined) throw envNotFound(this.deps, env, Object.keys(envs));
  }

  // One gate at a time, before the pool: a version probe's short deadline would not
  // survive the pool's concurrent subprocesses, and a ready tool would read as unknown.
  private async warmGates(
    repos: readonly ResolvedRepo[],
    checks: readonly Check[],
    input: ReleaseInput,
  ): Promise<void> {
    const doc = this.deps.ctx.manifest.workspace.result.doc;
    const policies = repos.map((repo) => releasePolicyOf(doc, repo.name));
    if (needsCodeHost(checks, input)) await this.gates.through('code-host', undefined);
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

  // The checklist is the team's, so the shared registry is read without the personal layer.
  private select(input: ReleaseInput): readonly ResolvedRepo[] {
    const doc = this.deps.ctx.manifest.workspace.result.doc;
    const shared = applyLocal(doc, {}).repos;
    for (const name of input.repos ?? []) {
      if (!shared.some((r) => r.name === name))
        throw workspaceItemNotFound(this.deps, {
          kind: 'repo',
          name,
          known: shared.map((r) => r.name),
          shared: true,
        });
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
    observedAt: Date,
  ): Promise<{ findings: ReleaseFinding[]; repo: ReleaseRepo }> {
    const shared = releasePolicyOf(this.deps.ctx.manifest.workspace.result.doc, repo.name);
    const ctx: CheckContext = {
      deps: this.deps,
      gates: this.gates,
      repo,
      policy: { ...shared, env: input.env ?? shared.env, since: input.since ?? shared.since },
      members: this.deps.ctx.manifest.members?.result.doc,
      now: observedAt,
      range: this.rangeFor(repo, input, observedAt),
      factsRequested: needsCodeHost(checks, input, repo.name),
      ...(input.versionHistory === undefined ? {} : { versionHistory: input.versionHistory }),
      ...(input.historyLimit === undefined ? {} : { historyLimit: input.historyLimit }),
      ...(input.versionPaths?.[repo.name] === undefined
        ? {}
        : { versionPath: input.versionPaths[repo.name] }),
      ...(input.baselines?.[repo.name] === undefined
        ? {}
        : { baselineRef: input.baselines[repo.name] }),
    };
    const facts = needsCodeHost(checks, input, repo.name)
      ? await gatherFacts(ctx)
      : { kind: 'error' as const, reason: 'not asked' };
    const [findings, described] = await Promise.all([
      Promise.all(checks.map((check) => CHECKERS[check](ctx, facts))),
      describeRepo(ctx, facts),
    ]);
    const errors = findings.find((finding) => finding.group === 'errors');
    return {
      findings,
      repo: {
        ...described,
        ...(described.facet_coverage === undefined
          ? {}
          : {
              facet_coverage: {
                ...described.facet_coverage,
                errors: errors?.coverage ?? 'not_requested',
              },
            }),
      },
    };
  }
}

function needsCodeHost(checks: readonly Check[], input: ReleaseInput, repo?: string): boolean {
  const overrides =
    repo === undefined
      ? Object.keys(input.versionPaths ?? {}).length > 0 ||
        Object.keys(input.baselines ?? {}).length > 0
      : input.versionPaths?.[repo] !== undefined || input.baselines?.[repo] !== undefined;
  return checks.some((check) => check !== 'errors') || input.versionHistory === true || overrides;
}

function commonRange(repos: readonly ReleaseRepo[]): TimeRange | null {
  const first = repos[0]?.range;
  return first !== undefined &&
    repos.every((repo) => repo.range?.start === first.start && repo.range.end === first.end)
    ? first
    : null;
}

const COVERAGE_HINT =
  'A repository is on it unless its manifest entry says release.covered: false.';

// The ways a selection can name nothing. An empty report reads as a pass,
// so each is an error instead; see Coverage in domain/report.ts.
function emptyChecklist(): DevkitError {
  return new DevkitError(
    'not_found',
    'CHECKLIST_EMPTY',
    'No repository in this workspace is on the release checklist',
    {
      hint: COVERAGE_HINT,
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
      hint: suggestionHint(suggestion, `Tags in use: ${known.join(', ') || '(none)'}.`),
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
      hint: COVERAGE_HINT,
      nextSteps: ['fx repo show <repo>', 'fx manifest explain repos[].release.covered'],
    },
  );
}
