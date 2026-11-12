// What one repository's release would carry: the head of each branch, the version
// declared at each head, and how many people's commits the source has and the target
// lacks. It describes, it does not judge. Whatever it cannot learn is null, and when
// that is because a question to the host failed, `unanswered` says which and why: some
// of these questions, such as the target's version, no check asks.

import path from 'node:path';

import { asDevkitError, DevkitError, toEnvelope } from '../../domain/errors.js';
import { DEPENDENCY_FILES } from '../../domain/release/deps.js';
import { attributed, peopleCommits, unmergedOf } from '../../domain/release/merge.js';
import type {
  AttributedCommit,
  ReleaseHead,
  ReleaseRepo,
  ReleaseFacetCoverage,
  Unanswered,
} from '../../domain/release/types.js';
import {
  declaredVersion,
  GRADLE_PROPERTIES,
  ROOT_VERSION,
  VERSION_READERS,
} from '../../domain/release/version.js';
import type { Branch } from '../../domain/workspace/commits.js';

import { readBaseline } from './baseline.js';
import type { CheckContext, FactsOutcome, RepoFacts } from './facts.js';
import { validateVersionPath } from './version-declaration.js';
import { readVersionHistory } from './version-history.js';

export async function describeRepo(ctx: CheckContext, outcome: FactsOutcome): Promise<ReleaseRepo> {
  const blank = emptyRepo(ctx);
  if (outcome.kind !== 'facts') {
    if (ctx.factsRequested === false) return blank;
    return { ...blank, unanswered: [missingFacts(outcome)] };
  }
  const { facts } = outcome;
  const { source, target } = facts;
  if (source === undefined)
    return {
      ...blank,
      unanswered: [
        {
          field: 'source',
          reason: `Release source ${ctx.policy.source} is absent`,
          error: toEnvelope(
            new DevkitError(
              'incomplete',
              'RELEASE_SOURCE_MISSING',
              `Release source ${ctx.policy.source} is absent`,
              {
                nextSteps: ['Inspect repository branches and release.source in the manifest.'],
              },
            ),
          ).error,
        },
      ],
    };
  const asked = new Questions();
  const file = await asked.about('version_file', () =>
    versionFileAt(facts, source.sha, ctx.versionPath),
  );
  const [sourceHead, targetHead, changes] = await Promise.all([
    headOf(asked, facts, source, 'source', file),
    target === undefined ? null : headOf(asked, facts, target, 'target', file),
    target === undefined
      ? undefined
      : asked.about('unmerged', () => changesBetween(ctx, facts, target.sha, source.sha)),
  ]);
  const versioned = sourceHead.version !== null || (targetHead?.version ?? null) !== null;
  const { history, baseline } = await readEvidence(ctx, facts, source);
  return {
    ...blank,
    source: sourceHead,
    target: targetHead,
    version_file: versioned ? (file ?? null) : null,
    unmerged: changes === undefined ? null : unmergedOf(changes),
    unanswered: asked.unanswered(),
    version_evidence: history,
    baseline_evidence: baseline,
    facet_coverage: {
      declaration: asked.unanswered().length === 0 ? 'checked' : 'incomplete',
      version_history: history?.coverage ?? 'not_requested',
      baseline: baseline?.coverage ?? 'not_requested',
      errors: 'not_requested',
    },
  };
}

async function readEvidence(ctx: CheckContext, facts: RepoFacts, source: Branch) {
  const [history, baseline] = await Promise.all([
    ctx.versionHistory === true || ctx.versionPath !== undefined
      ? readVersionHistory({
          host: facts.host,
          ref: facts.ref,
          requestedRef: source.name,
          resolvedSha: source.sha,
          ...(ctx.versionPath === undefined ? {} : { path: ctx.versionPath }),
          ...(ctx.historyLimit === undefined ? {} : { maxCommits: ctx.historyLimit }),
        })
      : null,
    ctx.baselineRef === undefined
      ? null
      : readBaseline({
          host: facts.host,
          ref: facts.ref,
          baselineRef: ctx.baselineRef,
          headRef: source.name,
          headSha: source.sha,
          ...(ctx.versionPath === undefined ? {} : { path: ctx.versionPath }),
        }),
  ]);
  return { history, baseline };
}

function emptyRepo(ctx: CheckContext): ReleaseRepo {
  return {
    name: ctx.repo.name,
    source: null,
    target: null,
    version_file: null,
    unmerged: null,
    note: ctx.policy.note ?? null,
    unanswered: [],
    ...(ctx.range === undefined ? {} : { range: ctx.range }),
    version_evidence: null,
    baseline_evidence: null,
    facet_coverage: emptyFacets(ctx),
  };
}

function missingFacts(outcome: Exclude<FactsOutcome, { kind: 'facts' }>): Unanswered {
  const reason = outcome.kind === 'gate' ? outcome.gate.reason : outcome.reason;
  const original = outcome.kind === 'error' ? outcome.failure : undefined;
  const handoff = outcome.kind === 'gate' ? outcome.gate.verdict?.handoff : undefined;
  const error =
    original ??
    toEnvelope(
      new DevkitError('incomplete', 'RELEASE_FACTS_UNAVAILABLE', reason, {
        nextSteps: [handoff?.command ?? 'fx can code-host'],
      }),
    ).error;
  return {
    field: 'code_host',
    reason,
    error: { ...error, ...(handoff === null || handoff === undefined ? {} : { handoff }) },
  };
}

function emptyFacets(ctx: CheckContext): ReleaseFacetCoverage {
  return {
    declaration: ctx.factsRequested === false ? 'not_requested' : 'incomplete',
    version_history:
      ctx.versionHistory === true || ctx.versionPath !== undefined ? 'incomplete' : 'not_requested',
    baseline: ctx.baselineRef === undefined ? 'not_requested' : 'incomplete',
    errors: 'not_requested',
  };
}

// The order the report names what it could not learn, whatever order the host failed in.
const FIELDS = [
  'version_file',
  'source.commit',
  'source.version',
  'target.commit',
  'target.version',
  'unmerged',
];

// The questions put to the host, keeping the reason for each one that failed.
class Questions {
  private readonly failed: Unanswered[] = [];

  async about<T>(field: string, ask: () => Promise<T>): Promise<T | undefined> {
    try {
      return await ask();
    } catch (err) {
      const failure = asDevkitError(err);
      this.failed.push({ field, reason: failure.message, error: toEnvelope(failure).error });
      return undefined;
    }
  }

  unanswered(): Unanswered[] {
    return [...this.failed].sort((a, b) => FIELDS.indexOf(a.field) - FIELDS.indexOf(b.field));
  }
}

async function headOf(
  asked: Questions,
  facts: RepoFacts,
  branch: Branch,
  side: 'source' | 'target',
  file: string | undefined,
): Promise<ReleaseHead> {
  const [commit, version] = await Promise.all([
    asked.about(`${side}.commit`, () => facts.host.commit(facts.ref, branch.sha)),
    file === undefined
      ? undefined
      : asked.about(`${side}.version`, () => versionAt(facts, file, branch.sha)),
  ]);
  return {
    branch: branch.name,
    sha: branch.sha,
    date: commit?.date ?? null,
    message: commit?.message ?? null,
    version: version ?? null,
  };
}

// Prefer the explicit root VERSION file, then the dependency file the deps check reads.
async function versionFileAt(
  facts: RepoFacts,
  sha: string,
  explicit?: string,
): Promise<string | undefined> {
  if (explicit !== undefined) {
    validateVersionPath(explicit);
    return resolveDeclarationFile(facts, explicit, sha);
  }
  if ((await facts.host.readFile(facts.ref, ROOT_VERSION, sha)) !== undefined) return ROOT_VERSION;
  for (const { file } of DEPENDENCY_FILES) {
    const text = await facts.host.readFile(facts.ref, file, sha);
    if (text !== undefined)
      return VERSION_READERS[file] === undefined
        ? undefined
        : resolveDeclarationFile(facts, file, sha);
  }
  return undefined;
}

async function versionAt(facts: RepoFacts, file: string, sha: string): Promise<string | undefined> {
  const text = await facts.host.readFile(facts.ref, file, sha);
  const own = text === undefined ? undefined : declaredVersion(file, text);
  if (own !== undefined || !gradle(file)) return own;
  const propertiesFile = path.posix.join(path.posix.dirname(file), GRADLE_PROPERTIES);
  const properties = await facts.host.readFile(facts.ref, propertiesFile, sha);
  return properties === undefined ? undefined : declaredVersion(propertiesFile, properties);
}

async function changesBetween(
  ctx: CheckContext,
  facts: RepoFacts,
  from: string,
  to: string,
): Promise<AttributedCommit[]> {
  const commits = await facts.host.compare(facts.ref, { from, to });
  return peopleCommits(commits, ctx.policy.bots).map((c) => attributed(ctx.members, c));
}

function gradle(file: string): boolean {
  return ['build.gradle', 'build.gradle.kts'].includes(path.posix.basename(file));
}

async function resolveDeclarationFile(
  facts: RepoFacts,
  file: string,
  sha: string,
): Promise<string> {
  if (!gradle(file)) return file;
  const text = await facts.host.readFile(facts.ref, file, sha);
  if (text !== undefined && declaredVersion(file, text) !== undefined) return file;
  const sibling = path.posix.join(path.posix.dirname(file), GRADLE_PROPERTIES);
  return (await facts.host.readFile(facts.ref, sibling, sha)) === undefined ? file : sibling;
}
