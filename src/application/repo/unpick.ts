// Dropping shared repositories from this machine's scope; nothing on disk moves.

import type { WorkspaceDeps } from '../workspace/deps.js';

import { editSelection, type SelectionInput, type SelectionOutput } from './selection.js';

export class RepoUnpick {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(input: SelectionInput): Promise<SelectionOutput> {
    return editSelection(this.deps, input, 'unpick');
  }
}
