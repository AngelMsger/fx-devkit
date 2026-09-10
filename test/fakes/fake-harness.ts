import { DevkitError } from '../../src/domain/errors.js';
import type { HarnessState } from '../../src/domain/harness/ownership.js';
import type { HarnessStateStore } from '../../src/ports/harness-state.js';
import type {
  ProjectionPath,
  ProjectionSnapshot,
  ProjectionStore,
  ProjectionWrite,
} from '../../src/ports/projection.js';

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
export class FakeProjectionStore implements ProjectionStore {
  readonly files = new Map<string, string>();
  writes = 0;
  async read(at: ProjectionPath): Promise<ProjectionSnapshot> {
    const text = this.files.get(at.relative);
    return text === undefined ? { kind: 'absent', text: null } : { kind: 'file', text };
  }
  async write(input: ProjectionWrite): Promise<'written' | 'unchanged' | 'conflict'> {
    const before = await this.read(input);
    if (before.kind !== input.before.kind || before.text !== input.before.text) return 'conflict';
    if (before.text === input.text) return 'unchanged';
    this.writes++;
    if (input.text === null) this.files.delete(input.relative);
    else this.files.set(input.relative, input.text);
    return 'written';
  }
}
