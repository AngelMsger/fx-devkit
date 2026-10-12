// What one repository's release would carry: the head of each branch, the version
// declared at each head, and the people's commits the source has and the target
// lacks. It describes, it does not judge; whatever it cannot learn is null, and the
// checks' findings already say why.

import { DEPENDENCY_FILES } from '../../domain/release/deps.js';
import { attributed, peopleCommits } from '../../domain/release/merge.js';
import type { ReleaseHead, ReleaseRepo } from '../../domain/release/types.js';
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
    changes: null,
    note: ctx.policy.note ?? null,
  };
  if (outcome.kind !== 'facts') return blank;
  const { facts } = outcome;
  const { source, target } = facts;
  if (source === undefined) return blank;
  const file = await quietly(() => versionFileAt(facts, source.sha));
  const [sourceHead, targetHead, changes] = await Promise.all([
    headOf(facts, source, file),
    target === undefined ? null : headOf(facts, target, file),
    target === undefined
      ? undefined
      : quietly(() => changesBetween(ctx, facts, target.sha, source.sha)),
  ]);
  const versioned = sourceHead.version !== null || (targetHead?.version ?? null) !== null;
  return {
    ...blank,
    source: sourceHead,
    target: targetHead,
    version_file: versioned ? (file ?? null) : null,
    changes: changes ?? null,
  };
}

async function headOf(
  facts: RepoFacts,
  branch: Branch,
  file: string | undefined,
): Promise<ReleaseHead> {
  const [commit, version] = await Promise.all([
    quietly(() => facts.host.commit(facts.ref, branch.sha)),
    file === undefined ? undefined : quietly(() => versionAt(facts, file, branch.sha)),
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
): Promise<ReleaseRepo['changes']> {
  const commits = await facts.host.compare(facts.ref, { from, to });
  return peopleCommits(commits, ctx.policy.bots).map((c) => attributed(ctx.members, c));
}

function gradle(file: string): boolean {
  return file.startsWith('build.gradle');
}

// Whatever the host could not say stays unknown here; the checks report the failure.
async function quietly<T>(ask: () => Promise<T>): Promise<T | undefined> {
  try {
    return await ask();
  } catch {
    return undefined;
  }
}
