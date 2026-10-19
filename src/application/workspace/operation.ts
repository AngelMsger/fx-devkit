// Identity operations serialize outside projection leases; nested projection work keeps its existing locks.

import { busyError, type DevkitError } from '../../domain/errors.js';
import { withLease } from '../../domain/lease.js';
import type { Lease, Lock, LockRequest } from '../../ports/lock.js';

export async function acquireWorkspaceOperation(lock: Lock, name: string): Promise<Lease> {
  const lease = await lock.acquire(operationRequest(name));
  if (!lease) throw operationBusy(name);
  return lease;
}
export async function withWorkspaceOperation<T>(
  lock: Lock,
  name: string,
  dryRun: boolean,
  work: () => Promise<T>,
): Promise<T> {
  if (dryRun) return work();
  return withLease(lock, operationRequest(name), () => operationBusy(name), work);
}

function operationRequest(name: string): LockRequest {
  return { key: `workspace-operation:${name}`, waitMs: 2000 };
}

function operationBusy(name: string): DevkitError {
  return busyError('LOCK_BUSY', `Workspace "${name}"`, {
    nextSteps: ['Retry the same command shortly.'],
  });
}
