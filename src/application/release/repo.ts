// What one repository's release would carry: the head of each branch, the version
// declared at each head, and how many people's commits the source has and the target
// lacks. It describes, it does not judge. Whatever it cannot learn is null, and when
// that is because a question to the host failed, `unanswered` says which and why: some
// of these questions, such as the target's version, no check asks.

import { asDevkitError } from '../../domain/errors.js';
import { DEPENDENCY_FILES } from '../../domain/release/deps.js';
import { attributed, peopleCommits, unmergedOf } from '../../domain/release/merge.js';
import type {
  AttributedCommit,
  ReleaseHead,
  ReleaseRepo,
  Unanswered,
} from '../../domain/release/types.js';
import {
  declaredVersion,
  GRADLE_PROPERTIES,
  VERSION_READERS,
} from '../../domain/release/version.js';
import type { Branch } from '../../domain/workspace/commits.js';

import type { CheckContext, FactsOutcome, RepoFacts } from './facts.js';

export async function describeRepo(ctx: CheckContext, outcome: FactsOutcome): Promise<ReleaseRepo> {
  const blank: ReleaseRepo = {
    name: ctx.repo.name,
    source: null,
    target: null,
    version_file: null,
    unmerged: null,
    note: ctx.policy.note ?? null,
    unanswered: [],
  };
  if (outcome.kind !== 'facts') return blank;
  const { facts } = outcome;
  const { source, target } = facts;
  if (source === undefined) return blank;
  const asked = new Questions();
  const file = await asked.about('version_file', () => versionFileAt(facts, source.sha));
  const [sourceHead, targetHead, changes] = await Promise.all([
    headOf(asked, facts, source, 'source', file),
    target === undefined ? null : headOf(asked, facts, target, 'target', file),
    target === undefined
      ? undefined
      : asked.about('unmerged', () => changesBetween(ctx, facts, target.sha, source.sha)),
  ]);
  const versioned = sourceHead.version !== null || (targetHead?.version ?? null) !== null;
  return {
    ...blank,
    source: sourceHead,
    target: targetHead,
    version_file: versioned ? (file ?? null) : null,
    unmerged: changes === undefined ? null : unmergedOf(changes),
    unanswered: asked.unanswered(),
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
      this.failed.push({ field, reason: asDevkitError(err).message });
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

// The dependency file the deps check reads, when it is a kind that declares a version.
async function versionFileAt(facts: RepoFacts, sha: string): Promise<string | undefined> {
  for (const { file } of DEPENDENCY_FILES) {
    const text = await facts.host.readFile(facts.ref, file, sha);
    if (text !== undefined) return VERSION_READERS[file] === undefined ? undefined : file;
  }
  return undefined;
}

async function versionAt(facts: RepoFacts, file: string, sha: string): Promise<string | undefined> {
  const text = await facts.host.readFile(facts.ref, file, sha);
  const own = text === undefined ? undefined : declaredVersion(file, text);
  if (own !== undefined || !gradle(file)) return own;
  const properties = await facts.host.readFile(facts.ref, GRADLE_PROPERTIES, sha);
  return properties === undefined ? undefined : declaredVersion(GRADLE_PROPERTIES, properties);
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
  return file.startsWith('build.gradle');
}
