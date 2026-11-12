// The latest transition into the current version on a bounded first-parent chain.
// Missing parents, renamed files and changed declaration identities stop the walk.

import { asDevkitError, toEnvelope } from '../../domain/errors.js';
import type {
  EvidenceFailure,
  VersionChange,
  VersionEvidence,
  VersionSource,
} from '../../domain/release/version-evidence.js';
import type { Commit } from '../../domain/workspace/commits.js';
import type { CodeHostQueries, RepoRef } from '../../ports/code-host.js';

import { readVersionDeclaration, versionFailure } from './version-declaration.js';

export interface VersionHistoryQuery {
  readonly host: CodeHostQueries;
  readonly ref: RepoRef;
  readonly requestedRef: string;
  readonly resolvedSha?: string;
  readonly path?: string;
  readonly source?: VersionSource;
  // Number of first-parent edges to examine, not a time range.
  readonly maxCommits?: number;
}

export async function readVersionHistory(input: VersionHistoryQuery): Promise<VersionEvidence> {
  let result = blankEvidence(input);
  try {
    const limit = input.maxCommits ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw versionFailure(
        'VERSION_HISTORY_BUDGET_INVALID',
        'History budget must be between 1 and 1000 commits',
      );
    let current = await input.host.commit(input.ref, input.resolvedSha ?? input.requestedRef);
    if (input.resolvedSha !== undefined && current.sha !== input.resolvedSha)
      throw versionFailure(
        'VERSION_REF_CHANGED',
        'The code host did not return the pinned head commit',
      );
    result = { ...result, resolved_sha: current.sha, next_sha: current.sha };
    const declaration = await readVersionDeclaration({ ...input, sha: current.sha });
    result = { ...result, declaration };
    const seen = new Set<string>();
    for (let count = 0; count < limit; count += 1) {
      if (seen.has(current.sha))
        throw versionFailure('VERSION_HISTORY_CYCLE', 'The first-parent history repeated a commit');
      seen.add(current.sha);
      result = { ...result, commits_read: count + 1 };
      const parentSha = current.parents[0];
      if (parentSha === undefined) return changed(result, current, null, 'root_declaration');
      result = { ...result, next_sha: parentSha };
      const parent = await input.host.commit(input.ref, parentSha);
      if (parent.sha !== parentSha)
        throw versionFailure(
          'VERSION_PARENT_MISMATCH',
          'The code host did not return the requested parent commit',
        );
      const previous = await readVersionDeclaration({
        ...input,
        sha: parent.sha,
        source: declaration,
      });
      if (previous.value !== declaration.value)
        return changed(result, current, previous.value, 'changed');
      current = parent;
    }
    result = { ...result, termination: 'limit' };
    throw versionFailure(
      'VERSION_HISTORY_LIMIT',
      `No version-field change found within ${limit} first-parent commits`,
    );
  } catch (error) {
    const failure = asDevkitError(error);
    let termination = result.termination;
    if (termination !== 'limit')
      termination = failure.category === 'incomplete' ? 'boundary' : 'query_failed';
    return { ...result, termination, failures: [toEnvelope(failure).error] };
  }
}

function blankEvidence(input: VersionHistoryQuery): VersionEvidence {
  return {
    requested_ref: input.requestedRef,
    resolved_sha: null,
    declaration: null,
    last_change: null,
    coverage: 'incomplete',
    commits_read: 0,
    failures: [],
    termination: 'query_failed',
    next_sha: input.resolvedSha ?? null,
  };
}

function changed(
  result: VersionEvidence,
  commit: Commit,
  previous: string | null,
  kind: VersionChange['kind'],
): VersionEvidence {
  const dated = Number.isFinite(Date.parse(commit.date));
  const failures: EvidenceFailure[] = dated
    ? []
    : [
        toEnvelope(
          versionFailure(
            'VERSION_CHANGE_UNDATED',
            'The version-field change has no readable committer timestamp',
          ),
        ).error,
      ];
  return {
    ...result,
    coverage: dated ? 'checked' : 'incomplete',
    failures,
    termination: kind,
    next_sha: null,
    last_change: {
      commit_sha: commit.sha,
      committed_at: dated ? commit.date : null,
      previous_value: previous,
      current_value: result.declaration?.value ?? '',
      history_mode: 'first_parent',
      kind,
    },
  };
}
