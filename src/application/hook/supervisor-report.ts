// A background supervisor writes to no stream a person reads, so the way its
// run ended is kept where the run's own phases are: one dated status field,
// replaced by the next run that ends the same way.

import type { HookObservation } from '../../domain/harness/state.js';
import { hooksLeaseKey } from '../../domain/lease.js';
import { samePath } from '../../domain/path.js';
import type { Clock } from '../../ports/clock.js';
import type { HookStateStore } from '../../ports/hook-state.js';
import type { Lock } from '../../ports/lock.js';

export interface SupervisorReportDeps {
  readonly clock: Clock;
  readonly state: HookStateStore;
  readonly lock: Lock;
}

export interface SupervisorReportInput {
  readonly workspace: string;
  readonly root: string;
  readonly reason: string;
}

const PHASE = 'run';

export async function recordRunFailure(
  deps: SupervisorReportDeps,
  input: SupervisorReportInput,
): Promise<void> {
  const lease = await deps.lock.acquire({ key: hooksLeaseKey(input.workspace), waitMs: 0 });
  if (!lease) return;
  try {
    const current = await deps.state.read(input.workspace);
    // A supervisor that failed is no evidence of a registration: a workspace
    // with no hook metadata, or metadata for another root, keeps what it has.
    if (!current || !samePath(current.root, input.root)) return;
    const observation: HookObservation = {
      phase: PHASE,
      code: input.reason,
      command: 'fx sync',
      checkedAt: deps.clock.now().getTime(),
    };
    await deps.state.write(input.workspace, {
      ...current,
      observations: [
        ...current.observations.filter((previous) => previous.phase !== PHASE),
        observation,
      ],
    });
  } finally {
    await lease.release();
  }
}
