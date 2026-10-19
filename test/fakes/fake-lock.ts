// A lock that grants every lease unless a case marks it busy, and records what was
// asked of it and what is still held, so a test asserts on keys and on the release.
import type { Lease, Lock, LockRequest } from '../../src/ports/lock.js';

type AcquireHook = (request: LockRequest) => void | Promise<void>;

export class FakeLock implements Lock {
  readonly requests: LockRequest[] = [];
  private readonly held: string[] = [];
  private readonly busyKeys = new Set<string>();
  private everyKeyBusy = false;
  private hook: AcquireHook = () => undefined;

  // Another holder keeps this key, or every key when none is named.
  busy(key?: string): this {
    if (key === undefined) this.everyKeyBusy = true;
    else this.busyKeys.add(key);
    return this;
  }

  // Runs while a lease is being granted, where a competing writer would have acted.
  onAcquire(hook: AcquireHook): this {
    this.hook = hook;
    return this;
  }

  // The keys of the leases granted and not released.
  unreleased(): readonly string[] {
    return [...this.held];
  }

  async acquire(request: LockRequest): Promise<Lease | null> {
    this.requests.push(request);
    if (this.everyKeyBusy || this.busyKeys.has(request.key)) return null;
    await this.hook(request);
    this.held.push(request.key);
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        this.held.splice(this.held.indexOf(request.key), 1);
      },
    };
  }
}
