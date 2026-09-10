// Candidate content is the upstream baseline overlaid with captured selected
// bytes. The caller's live index and unrelated working files are not inputs.

import { selectContributionFiles } from './selection.js';
import type { ContributionFile } from './snapshot.js';

interface CandidateInput {
  readonly base: Readonly<Record<string, string>>;
  readonly changes: readonly ContributionFile[];
}

export function buildContributionCandidate(
  input: CandidateInput,
): Readonly<Record<string, string>> {
  const candidate = { ...input.base };
  const selected = selectContributionFiles({
    paths: input.changes.map((file) => file.path),
    changes: input.changes,
  });
  for (const file of selected) {
    if (file.content === null) delete candidate[file.path];
    else
      Object.defineProperty(candidate, file.path, {
        value: file.content,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return Object.freeze(candidate);
}
