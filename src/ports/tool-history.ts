// Durable append-only installation checkpoints, shared by workspaces under one FX_HOME.

import type { ToolInstallation } from '../domain/toolchain/installation.js';

export interface ToolHistoryStore {
  read(): Promise<readonly ToolInstallation[]>;
  append(entry: ToolInstallation): Promise<void>;
}
