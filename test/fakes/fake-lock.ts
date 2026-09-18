// A lock that always grants the lease, for tests whose subject is not contention.
import type { Lease, Lock } from '../../src/ports/lock.js';

export class FakeLock implements Lock {
  async acquire(): Promise<Lease> {
    return { release: async () => undefined };
  }
}
