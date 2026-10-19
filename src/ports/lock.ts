// A lease serializes a resource across processes. A bounded unsuccessful
// acquisition is a value, allowing lifecycle callers to skip rather than wait.

import type { LeaseRequest as LockRequest } from '../domain/lease.js';

export type { LockRequest };

export interface Lease {
  release(): Promise<void>;
}

export interface Lock {
  acquire(input: LockRequest): Promise<Lease | null>;
}
