// Work a test holds open: each call is recorded when it starts and finishes only when the
// test releases it, so what runs at once is asserted without a clock.

export class HeldWork<K> {
  readonly started: K[] = [];
  private readonly held = new Map<K, () => void>();
  private readonly watchers: { count: number; reached: () => void }[] = [];
  private open = false;

  // Awaited at the start of the work under test.
  hold(key: K): Promise<void> {
    this.started.push(key);
    for (const watcher of this.watchers)
      if (this.started.length >= watcher.count) watcher.reached();
    if (this.open) return Promise.resolve();
    return new Promise((resolve) => this.held.set(key, resolve));
  }

  // Resolves once `count` calls have started, then lets every runnable continuation run:
  // a call that was going to start alongside them has started by the time this returns.
  async reached(count: number): Promise<void> {
    if (this.started.length < count)
      await new Promise<void>((reached) => this.watchers.push({ count, reached }));
    await settled();
  }

  release(key: K): void {
    const finish = this.held.get(key);
    if (finish === undefined) throw new Error(`nothing is held for ${String(key)}`);
    this.held.delete(key);
    finish();
  }

  // Finishes everything held and lets later calls through.
  releaseAll(): void {
    this.open = true;
    for (const finish of this.held.values()) finish();
    this.held.clear();
  }
}

// Runs the continuations that are already runnable. It waits on no clock.
export function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
