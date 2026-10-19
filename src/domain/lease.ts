// Lease vocabulary shared across layers. A key two modules must spell alike is
// built here: a mismatch loses mutual exclusion without any error, and the text
// is what an fx of another version already holds. withLease is the bracket for
// a caller that fails on contention; one that reports contention as a value
// acquires for itself.

import { pathKey } from './path.js';

export interface LeaseRequest {
  readonly key: string;
  readonly waitMs: number;
}

interface LeaseSource {
  acquire(request: LeaseRequest): Promise<{ release(): Promise<void> } | null>;
}

// Writers of one workspace's manifest source, managed resources and registration.
export function workspaceLeaseKey(workspace: string): string {
  return `workspace:${workspace}`;
}

// Writers of one workspace's hook preference, receipts and observations.
export function hooksLeaseKey(workspace: string): string {
  return `hooks:${workspace}`;
}

// Writers of one projected file or directory.
export function projectionLeaseKey(file: string): string {
  return `projection:${pathKey(file)}`;
}

export async function withLease<T>(
  lock: LeaseSource,
  request: LeaseRequest,
  busy: () => Error,
  work: () => Promise<T>,
): Promise<T> {
  const lease = await lock.acquire(request);
  if (!lease) throw busy();
  try {
    return await work();
  } finally {
    await lease.release();
  }
}
