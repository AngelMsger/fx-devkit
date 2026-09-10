// Ownership and automatic-sync observations stay on the machine and are
// excluded from exported profiles. Callers serialize compound updates.

import type { HookState } from '../domain/harness/state.js';

export interface HookStateStore {
  read(workspace: string): Promise<HookState | null>;
  write(workspace: string, state: HookState): Promise<void>;
}
