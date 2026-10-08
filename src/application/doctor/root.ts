// A stray root entry is clutter, not a broken workspace: it warns and never
// blocks preparation. Only an unregistered checkout has a command that settles it;
// where anything else goes is the owner's decision.

import { WORKBENCH_DIR, type RootEntryKind } from '../../domain/workspace/root-entries.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';
import { strayRootEntries, type RootInventory } from '../workspace/root-entries.js';

import { finding, type Finding } from './types.js';

const MESSAGE: Readonly<Record<RootEntryKind, string>> = {
  checkout: 'checkout not registered with this workspace',
  directory: `directory outside ${WORKBENCH_DIR}`,
  file: `file outside ${WORKBENCH_DIR}`,
  link: `link outside ${WORKBENCH_DIR}`,
};

export async function checkRoot(deps: WorkspaceDeps, inventory: RootInventory): Promise<Finding[]> {
  const strays = await strayRootEntries(deps, inventory);
  if (strays.length === 0)
    return [finding('root', 'entries', 'ok', 'every root entry is accounted for')];
  return strays.map((entry) =>
    finding('root', entry.name, 'warn', MESSAGE[entry.kind], {
      required: false,
      ...(entry.kind === 'checkout'
        ? { fix: workspaceCommand(deps, 'repo', 'add', entry.name) }
        : {}),
    }),
  );
}
