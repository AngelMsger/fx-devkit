// One workspace's contribution journal is replaced atomically while the
// application holds its workspace/source leases. Absence is an empty journal.

import type { ContributionOperation } from '../domain/contribution/operation.js';

export interface ContributionStore {
  read(workspace: string): Promise<readonly ContributionOperation[]>;
  write(workspace: string, operations: readonly ContributionOperation[]): Promise<void>;
}
