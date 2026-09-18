// Identity operations serialize outside projection leases; nested projection work keeps its existing locks.

import { busyError } from '../../domain/errors.js';
import type { Lease, Lock } from '../../ports/lock.js';

export async function acquireWorkspaceOperation(lock: Lock, name: string): Promise<Lease> {
  const lease = await lock.acquire({ key: `workspace-operation:${name}`, waitMs: 2000 });
  if (!lease)
    throw busyError('LOCK_BUSY', `Workspace "${name}"`, {
      nextSteps: ['Retry the same command shortly.'],
    });
  return lease;
}
export async function withWorkspaceOperation<T>(
  lock: Lock,
  name: string,
  dryRun: boolean,
  work: () => Promise<T>,
): Promise<T> {
  if (dryRun) return work();
  const lease = await acquireWorkspaceOperation(lock, name);
  try {
    return await work();
  } finally {
    await lease.release();
  }
}
