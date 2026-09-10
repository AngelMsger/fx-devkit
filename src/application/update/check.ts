// One probe, remembered for a window. A failure is remembered too, so a
// dead upstream is asked once per window. The cache is disposable: a cache
// that cannot be read is a miss, one that cannot be written is forgotten.

import type { Clock } from '../../ports/clock.js';
import type { Cache } from '../../ports/stores.js';

export interface Remembered<T> {
  readonly checked_at: number;
  readonly value?: T;
  readonly error?: string;
}

export interface Probed<T> {
  readonly value: T | undefined;
  readonly source: 'cache' | 'live';
  readonly error?: string;
}

export class CachedProbe {
  constructor(
    private readonly cache: Cache,
    private readonly clock: Clock,
  ) {}

  async run<T>(
    key: string,
    ttlMs: number,
    probe: () => Promise<T>,
    options: {
      readonly isValue: (value: unknown) => value is T;
      readonly force?: boolean | undefined;
      readonly signal?: AbortSignal | undefined;
    },
  ): Promise<Probed<T>> {
    const now = this.clock.now().getTime();
    const kept = await this.read<T>(key, options.isValue, options.signal);
    if (options.force !== true && kept !== undefined && now - kept.checked_at < ttlMs)
      return { value: kept.value, source: 'cache', ...errorOf(kept) };
    const fresh = await remember(probe, now);
    await this.write(key, fresh, ttlMs);
    return { value: fresh.value, source: 'live', ...errorOf(fresh) };
  }

  async remember<T>(key: string, ttlMs: number, value: T): Promise<void> {
    await this.write(key, { checked_at: this.clock.now().getTime(), value }, ttlMs);
  }

  // An entry from another version of fx, or a damaged one, is a miss.
  private async read<T>(
    key: string,
    isValue: (value: unknown) => value is T,
    signal?: AbortSignal,
  ): Promise<Remembered<T> | undefined> {
    try {
      const kept = await this.cache.get<Remembered<T>>(key, signal);
      if (kept === undefined || !Number.isFinite(kept.checked_at)) return undefined;
      if (kept.value === undefined) return typeof kept.error === 'string' ? kept : undefined;
      return isValue(kept.value) ? kept : undefined;
    } catch {
      return undefined;
    }
  }

  private async write<T>(key: string, entry: Remembered<T>, ttlMs: number): Promise<void> {
    try {
      await this.cache.set(key, entry, ttlMs);
    } catch {
      return;
    }
  }
}

async function remember<T>(probe: () => Promise<T>, now: number): Promise<Remembered<T>> {
  try {
    return { checked_at: now, value: await probe() };
  } catch (err) {
    return { checked_at: now, error: err instanceof Error ? err.message : String(err) };
  }
}

function errorOf<T>(kept: Remembered<T>): { error?: string } {
  return kept.error === undefined ? {} : { error: kept.error };
}
