// Candidate filenames are untrusted content too. Plans may identify a rejected
// path's position without exposing a credential or person embedded in its name.

import { scanBoundary } from '../boundary/scan.js';

export function displayContributionPaths(paths: readonly string[]): readonly string[] {
  return paths.map((value, index) =>
    scanBoundary({ text: value, policy: 'manifest' }).length
      ? `(protected path ${index + 1})`
      : value,
  );
}
