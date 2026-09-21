// A workspace name is a filesystem component under ~/.fx/workspaces and a
// key in config.yaml. Confining it to a plain identifier is what keeps a
// crafted profile or --name from writing outside the personal directory.

import { createHash } from 'node:crypto';
import path from 'node:path';

import { DevkitError } from '../errors.js';
import { windowsPathProblem } from '../path.js';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function defaultWorkspaceName(root: string, occupied: readonly string[] = []): string {
  const basename = path.basename(root);
  const key = (name: string): string => (path.sep === '\\' ? name.toLowerCase() : name);
  const used = new Set(occupied.map(key));
  if (
    NAME.test(basename) &&
    !basename.includes('..') &&
    !windowsPathProblem(basename) &&
    !used.has(key(basename))
  )
    return basename;
  const stem =
    basename
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 54) || 'workspace';
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 8);
  let name = `${stem}-${digest}`;
  for (let index = 2; used.has(key(name)); index += 1) {
    const suffix = `${digest}-${index}`;
    name = `${stem.slice(0, 63 - suffix.length)}-${suffix}`;
  }
  return name;
}

export function assertWorkspaceName(name: string): void {
  const windowsProblem = path.sep === '\\' ? windowsPathProblem(name) : undefined;
  if (NAME.test(name) && !name.includes('..') && !windowsProblem) return;
  throw new DevkitError(
    'usage',
    'WORKSPACE_NAME_INVALID',
    `"${name}" is not a usable workspace name`,
    {
      hint: 'Letters, digits, dot, dash and underscore, starting with a letter or digit.',
      nextSteps: ['fx init <dir> --from <source> --name <plain-name>'],
    },
  );
}

export function assertWorkspaceNames(names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    assertWorkspaceName(name);
    const key = path.sep === '\\' ? name.toLowerCase() : name;
    if (seen.has(key))
      throw new DevkitError(
        'config',
        'WORKSPACE_NAME_CONFLICT',
        `Workspace names alias the same local directory: ${name}`,
        {
          nextSteps: ['fx workspace list', `fx workspace unregister ${name}`],
        },
      );
    seen.add(key);
  }
}
