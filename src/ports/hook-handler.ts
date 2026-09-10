// Event handlers own their scheduling policy and status description. Dispatch
// owns validation and transport, so adding an event does not add a host branch.

import type { HookState } from '../domain/harness/state.js';

export interface HookHandler {
  shouldSchedule(ageMs: number): boolean;
  describe(state: HookState | null, readOnly: boolean): string;
}
