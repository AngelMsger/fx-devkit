// Projection ownership survives process interruption independently of native
// files. The caller holds the workspace lease around read/plan/write sequences.

import type { HarnessState } from '../domain/harness/ownership.js';

export interface HarnessStateStore {
  read(workspace: string): Promise<HarnessState | null>;
  write(workspace: string, state: HarnessState): Promise<void>;
}
