// Picking shared repositories into this machine's scope.

import type { WorkspaceDeps } from '../workspace/deps.js';

import { editSelection, type SelectionInput, type SelectionOutput } from './selection.js';

export class RepoPick {
  constructor(private readonly deps: WorkspaceDeps) {}

  execute(input: SelectionInput): Promise<SelectionOutput> {
    return editSelection(this.deps, input, 'pick');
  }
}
