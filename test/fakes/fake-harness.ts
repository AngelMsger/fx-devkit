import { DevkitError } from '../../src/domain/errors.js';
import type { HarnessState } from '../../src/domain/harness/ownership.js';
import type { HarnessStateStore } from '../../src/ports/harness-state.js';

export class FakeHarnessState implements HarnessStateStore {
  value: HarnessState | null = null;
  writes = 0;
  failAt: number | null = null;
  async read(): Promise<HarnessState | null> {
    return this.value;
  }
  async write(_workspace: string, state: HarnessState): Promise<void> {
    this.writes++;
    if (this.writes === this.failAt)
      throw new DevkitError('internal', 'FIXTURE_FAILURE', 'Journal interrupted.');
    this.value = structuredClone(state);
  }
}
