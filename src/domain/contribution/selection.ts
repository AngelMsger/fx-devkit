// Selection expands only known changed paths, never Git pathspec expressions.
// Renames require both endpoints so a contribution cannot silently become a copy.

import { scanBoundary } from '../boundary/scan.js';
import { DevkitError } from '../errors.js';
import { nearest } from '../fuzzy.js';

import type { ContributionFile } from './snapshot.js';

interface ContributionSelection {
  readonly paths: readonly string[];
  readonly changes: readonly ContributionFile[];
}

export function selectContributionFiles(input: ContributionSelection): readonly ContributionFile[] {
  if (input.paths.length === 0)
    throw new DevkitError('usage', 'INPUT_REQUIRED', 'Select files to contribute.');
  for (const path of input.paths) assertSafePath(path);
  for (const file of input.changes) assertSafePath(file.path);
  const selected = new Map<string, ContributionFile>();
  for (const path of input.paths) {
    const matches = input.changes.filter(
      (file) => file.path === path || file.path.startsWith(`${path}/`),
    );
    if (matches.length === 0) throw missingSelection(path, input.changes);
    for (const file of matches) selected.set(file.path, file);
  }
  for (const file of selected.values()) assertSupported(file, selected);
  return [...selected.values()].sort((a, b) => {
    if (a.path === b.path) return 0;
    return a.path < b.path ? -1 : 1;
  });
}

function assertSafePath(path: string): void {
  const segments = path.split('/');
  if (
    !path ||
    /[\\\x00-\x1f\x7f:]/u.test(path) ||
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.toLowerCase() === '.git',
    )
  )
    throw new DevkitError(
      'usage',
      'SOURCE_PATH_INVALID',
      'Contribution paths must be plain source-relative paths.',
    );
}

function assertSupported(
  file: ContributionFile,
  selected: ReadonlyMap<string, ContributionFile>,
): void {
  if (file.kind === 'symlink' || file.kind === 'gitlink')
    throw new DevkitError(
      'usage',
      'SOURCE_ENTRY_UNSUPPORTED',
      'Contributions accept regular files and deletions only.',
    );
  if ((file.kind === 'deleted') !== (file.content === null))
    throw new DevkitError(
      'conflict',
      'SOURCE_SNAPSHOT_INVALID',
      'The captured file state is inconsistent.',
    );
  if (file.renamePeer !== undefined && !selected.has(file.renamePeer))
    throw new DevkitError(
      'usage',
      'SOURCE_RENAME_INCOMPLETE',
      'Select both paths of a renamed file.',
    );
}

function missingSelection(value: string, changes: readonly ContributionFile[]): DevkitError {
  const suggestion = nearest(
    value,
    changes
      .map((file) => file.path)
      .filter((file) => scanBoundary({ text: file, policy: 'manifest' }).length === 0),
  );
  return new DevkitError(
    'usage',
    'SOURCE_SELECTION_EMPTY',
    'A selection matches no changed file.',
    {
      hint: suggestion
        ? `Did you mean "${suggestion}"?`
        : 'Choose changed files or directories relative to the source root.',
      nextSteps: ['Review the changed source paths and retry with an explicit selection.'],
    },
  );
}
