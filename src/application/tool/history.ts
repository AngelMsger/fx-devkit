// The installation checkpoints recorded under this FX_HOME, in the order the ledger
// keeps them. A name narrows them to one tool, whether or not a manifest still
// declares it.

import type { ToolInstallation } from '../../domain/toolchain/installation.js';
import type { ToolHistoryStore } from '../../ports/tool-history.js';

export class ToolHistory {
  constructor(private readonly store: Pick<ToolHistoryStore, 'read'>) {}

  async execute(input: {
    readonly name?: string | undefined;
  }): Promise<readonly ToolInstallation[]> {
    const history = await this.store.read();
    if (input.name === undefined) return history;
    return history.filter((entry) => entry.name === input.name);
  }
}
