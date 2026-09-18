// A workspace name is a filesystem component under ~/.fx/workspaces and a
// key in config.yaml. Confining it to a plain identifier is what keeps a
// crafted profile or --name from writing outside the personal directory.

import path from 'node:path';

import { DevkitError } from '../errors.js';
import { windowsPathProblem } from '../path.js';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
