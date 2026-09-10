// Coordinates trust, workspace locking and recoverable harness writes.

import { DevkitError } from '../../domain/errors.js';
import { assertWritable } from '../safety/posture.js';

import { applyHarnessChange, harnessConflict, readHarnessState } from './apply.js';
import { planHarness } from './plan.js';
import type { HarnessDeps, HarnessInput, HarnessOutput, HarnessPlan } from './types.js';

export class ReconcileHarness {
  constructor(private readonly deps: HarnessDeps) {}
  async execute(input: HarnessInput): Promise<HarnessOutput> {
    const preview = await planHarness(
      this.deps,
      input,
      await readHarnessState(this.deps, input, false),
    );
    if (input.dryRun || input.action === 'inspect') return { items: preview.items, written: false };
    const pending = (await this.deps.state.read(input.workspace))?.pending;
    if (!preview.changes.length && !preview.trusts.length && !pending)
      return { items: preview.items, written: false };
    assertWritable(input.posture, 'project workspace harness');
    for (const trust of preview.trusts) await this.deps.trust.ensure(trust);
    const lease = await this.deps.lock.acquire({
      key: `workspace:${input.workspace}`,
      waitMs: 2000,
    });
    if (!lease)
      throw new DevkitError('conflict', 'LOCK_BUSY', 'Workspace projections are busy.', {
        retryable: true,
        nextSteps: ['Retry shortly.'],
      });
    try {
      return await this.apply(input, preview);
    } finally {
      await lease.release();
    }
  }
  private async apply(input: HarnessInput, preview: HarnessPlan): Promise<HarnessOutput> {
    if (input.source) {
      const observed = await this.deps.files.read(input.source);
      if (JSON.stringify(observed) !== JSON.stringify(input.source.before)) throw harnessConflict();
    }
    const recovered = Boolean((await this.deps.state.read(input.workspace))?.pending);
    let state = await readHarnessState(this.deps, input, true);
    const current = await planHarness(this.deps, input, state);
    if (JSON.stringify(current.changes) !== JSON.stringify(preview.changes))
      throw harnessConflict();
    for (const change of current.changes)
      state = await applyHarnessChange(this.deps, input, state, change);
    return { items: current.items, written: current.changes.length > 0 || recovered };
  }
}
