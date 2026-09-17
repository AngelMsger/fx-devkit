// Registry integrity and recovery are independent of manifest contents.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { samePath } from '../../domain/path.js';
import { shellLine } from '../../domain/shell.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ConfigFile } from '../../ports/stores.js';

export async function assertDistinctWorkspaceRoot(
  config: ConfigFile,
  name: string,
  root: string,
  fs: FileSystem,
): Promise<void> {
  const physical = await fs.realpath(path.resolve(root));
  for (const [other, entry] of Object.entries(config.workspaces ?? {})) {
    if (other === name) continue;
    if (samePath(physical, await fs.realpath(path.resolve(entry.root))))
      throw new DevkitError(
        'conflict',
        'WORKSPACE_ROOT_TAKEN',
        `This directory is already registered as "${other}".`,
        {
          hint: 'One physical directory has one workspace identity. Rebind its source or relocate its registration.',
          nextSteps: [
            shellLine(['fx', 'workspace', 'show', other]),
            shellLine(['fx', 'workspace', 'rebind', other, '--from', '<source>']),
          ],
        },
      );
  }
}

export function assertDefaultWorkspace(config: ConfigFile): void {
  const name = config.default_workspace;
  if (name === undefined || config.workspaces?.[name] !== undefined) return;
  throw new DevkitError(
    'config',
    'WORKSPACE_DEFAULT_INVALID',
    `default_workspace references unregistered workspace "${name}".`,
    {
      hint: `Registered: ${
        Object.keys(config.workspaces ?? {})
          .sort()
          .join(', ') || '(none)'
      }.`,
      nextSteps: [
        'fx workspace list',
        'fx config unset default_workspace',
        'fx config set default_workspace <registered-name>',
      ],
    },
  );
}
