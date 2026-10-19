// Profile imports merge identities without bypassing workspace lifecycle operations.

import path from 'node:path';

import type { Profile } from '../../domain/config/profile.js';
import { DevkitError } from '../../domain/errors.js';
import { samePath } from '../../domain/path.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ConfigFile, WorkspaceEntry } from '../../ports/stores.js';
import { assertDefaultWorkspace, assertDistinctWorkspaceRoot } from '../workspace/registry.js';

export interface ImportRegistryDeps {
  readonly fs: FileSystem;
  readonly commandShell?: ResolvedShell;
}

export async function mergeProfileConfig(
  current: ConfigFile,
  incoming: Profile['config'],
  deps: ImportRegistryDeps,
): Promise<ConfigFile> {
  const fields = Object.fromEntries(
    Object.entries(incoming).filter(([, value]) => value !== undefined),
  );
  const workspaces: Record<string, WorkspaceEntry> = { ...current.workspaces };
  for (const [name, entry] of Object.entries(incoming.workspaces ?? {})) {
    const previous = current.workspaces?.[name];
    const root = await deps.fs.realpath(path.resolve(entry.root));
    if (previous !== undefined) {
      const oldRoot = await deps.fs.realpath(path.resolve(previous.root));
      if (!samePath(oldRoot, root))
        throw identityChange(
          name,
          'root',
          ['fx', 'workspace', 'relocate', name, root],
          deps.commandShell,
        );
      if (entry.source !== undefined && previous.source !== entry.source)
        throw identityChange(
          name,
          'source',
          ['fx', 'workspace', 'rebind', name, '--from', entry.source],
          deps.commandShell,
        );
    }
    const source = entry.source ?? previous?.source;
    workspaces[name] = { root, ...(source === undefined ? {} : { source }) };
  }
  const next: ConfigFile = {
    ...current,
    ...fields,
    ...(incoming.workspaces === undefined ? {} : { workspaces }),
  };
  assertDefaultWorkspace(next);
  for (const [name, entry] of Object.entries(next.workspaces ?? {}))
    await assertDistinctWorkspaceRoot(next, name, entry.root, deps);
  return next;
}

export function assertImportIdentitiesUnchanged(
  expected: ConfigFile,
  actual: ConfigFile,
  names: readonly string[],
  shell: ResolvedShell | undefined,
): void {
  for (const name of names) {
    if (JSON.stringify(expected.workspaces?.[name]) !== JSON.stringify(actual.workspaces?.[name]))
      throw new DevkitError(
        'conflict',
        'CONFIG_IMPORT_CHANGED',
        `Workspace "${name}" changed while the profile import was being planned`,
        {
          hint: 'Inspect its current identity and preview the profile again before retrying.',
          nextSteps: [shellLine(['fx', 'workspace', 'show', name], shell)],
        },
      );
  }
}

function identityChange(
  name: string,
  field: string,
  command: readonly string[],
  shell?: ResolvedShell,
): DevkitError {
  return new DevkitError(
    'conflict',
    'CONFIG_IMPORT_WORKSPACE_CONFLICT',
    `Import would change the ${field} of registered workspace "${name}"`,
    {
      hint: 'Use the workspace lifecycle command first so owned resources and personal selections remain consistent.',
      nextSteps: [
        shellLine(command, shell),
        'Retry the profile import after the workspace identity matches.',
      ],
    },
  );
}
