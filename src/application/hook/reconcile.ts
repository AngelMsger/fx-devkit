// Hook management plans every selected host before writing. Workspace leases
// serialize preferences and receipts; each file is rechecked by its projection
// store. Inspect and dry-run never create leases or change personal settings.

import { busyError, DevkitError } from '../../domain/errors.js';
import { hooksLeaseKey, withLease } from '../../domain/lease.js';
import { assertWritable } from '../safety/posture.js';

import { applyHookPlan } from './apply.js';
import { hookOutput } from './output.js';
import { planHooks } from './plan.js';
import type { HookDeps, HookOutput, HookPlan, ReconcileInput } from './types.js';

export class ReconcileHooks {
  constructor(private readonly deps: HookDeps) {}

  async execute(input: ReconcileInput): Promise<HookOutput> {
    const preview = await planHooks(this.deps, input);
    if (input.action === 'inspect' || input.dryRun) return hookOutput(preview);
    if (input.action === 'inject' && !input.globalEnabled)
      throw new DevkitError('config', 'HOOKS_DISABLED', 'Hooks are disabled globally', {
        hint: 'The workspace preference cannot override the global switch.',
        nextSteps: ['fx config get hooks --explain'],
      });
    if (settled(input, preview)) return hookOutput(preview);
    assertWritable(input.posture, 'manage workspace hooks');
    return withLease(
      this.deps.lock,
      { key: hooksLeaseKey(input.workspace), waitMs: 2000 },
      () => busyError('LOCK_BUSY', 'The workspace hook configuration'),
      async () => applyHookPlan(this.deps, input, await planHooks(this.deps, input)),
    );
  }
}

// An ordinary sync writes nothing while hooks are off, and nothing while every
// projection already matches and the receipts exist to prove fx wrote them.
function settled(input: ReconcileInput, preview: HookPlan): boolean {
  if (input.action !== 'sync' || input.removeAgents) return false;
  if (!preview.enabled) return true;
  return preview.plans.every((p) => p.before.text === p.text) && preview.state !== null;
}
