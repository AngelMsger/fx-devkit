// A caller-selected historical baseline, pinned before reading declarations and
// comparing the full commit range. It does not reuse the release's unmerged count.

import { asDevkitError, toEnvelope } from '../../domain/errors.js';
import type {
  BaselineEvidence,
  EvidenceFailure,
  VersionSnapshot,
  VersionSource,
} from '../../domain/release/version-evidence.js';
import type { CodeHostQueries, RepoRef } from '../../ports/code-host.js';

import { readVersionDeclaration, versionFailure } from './version-declaration.js';

export interface BaselineQuery {
  readonly host: CodeHostQueries;
  readonly ref: RepoRef;
  readonly baselineRef: string;
  readonly headRef: string;
  readonly headSha?: string;
  readonly path?: string;
  readonly source?: VersionSource;
}

export async function readBaseline(input: BaselineQuery): Promise<BaselineEvidence> {
  const failures: EvidenceFailure[] = [];
  const ask = async <T>(run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      failures.push(toEnvelope(asDevkitError(error)).error);
      return null;
    }
  };
  const baseline = await ask(() => input.host.commit(input.ref, input.baselineRef));
  const head = await ask(async () => {
    const commit = await input.host.commit(input.ref, input.headSha ?? input.headRef);
    if (input.headSha !== undefined && commit.sha !== input.headSha)
      throw versionFailure(
        'VERSION_REF_CHANGED',
        'The code host did not return the pinned head commit',
      );
    return commit;
  });
  const current =
    head === null ? null : await ask(() => readVersionDeclaration({ ...input, sha: head.sha }));
  const source = input.source ?? current ?? undefined;
  const previous =
    baseline === null
      ? null
      : await ask(() =>
          readVersionDeclaration({
            ...input,
            ...(source === undefined ? {} : { source }),
            sha: baseline.sha,
          }),
        );
  const commits =
    baseline === null || head === null
      ? null
      : await ask(() => input.host.compare(input.ref, { from: baseline.sha, to: head.sha }));
  const snapshot = (
    requestedRef: string,
    sha: string | undefined,
    declaration: VersionSnapshot['declaration'],
  ): VersionSnapshot => ({ requested_ref: requestedRef, resolved_sha: sha ?? null, declaration });
  return {
    baseline: snapshot(input.baselineRef, baseline?.sha, previous),
    head: snapshot(input.headRef, head?.sha, current),
    commits,
    coverage: failures.length === 0 ? 'checked' : 'incomplete',
    failures,
  };
}
