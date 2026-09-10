import { describe, expect, it } from 'vitest';

import { CachedProbe } from '../../../../src/application/update/check.js';
import type { Cache } from '../../../../src/ports/stores.js';
import { FakeCache } from '../../../fakes/fake-cache.js';
import { FakeClock } from '../../../fakes/fake-clock.js';

class BrokenCache implements Cache {
  async get<T>(): Promise<T | undefined> {
    throw new Error('cannot read');
  }
  async set(): Promise<void> {
    throw new Error('cannot write');
  }
}

const isString = (v: unknown): v is string => typeof v === 'string';

describe('CachedProbe over a cache that cannot be trusted', () => {
  it('treats a failing cache as a miss and a failing write as nothing, and probes anyway', async () => {
    const probe = new CachedProbe(new BrokenCache(), new FakeClock());
    const out = await probe.run('k', 1000, async () => 'live', { isValue: isString });
    expect(out).toMatchObject({ value: 'live', source: 'live' });
    await expect(probe.remember('k', 1000, 'v')).resolves.toBeUndefined();
  });

  it('ignores a cached entry of the wrong shape, a non-finite timestamp, or a value that fails validation', async () => {
    const cache = new FakeCache();
    const probe = new CachedProbe(cache, new FakeClock());
    const live = async (): Promise<string> => 'live';
    await cache.set('k', { junk: true });
    expect((await probe.run('k', 1000, live, { isValue: isString })).source).toBe('live');
    await cache.set('k', { checked_at: Number.NaN, value: 'x' });
    expect((await probe.run('k', 1000, live, { isValue: isString })).source).toBe('live');
    await cache.set('k', { checked_at: new FakeClock().now().getTime(), value: { nested: 1 } });
    expect((await probe.run('k', 1000, live, { isValue: isString })).source).toBe('live');
    await cache.set('k', { checked_at: new FakeClock().now().getTime() });
    expect((await probe.run('k', 1000, live, { isValue: isString })).source).toBe('live');
    await cache.set('k', { checked_at: new FakeClock().now().getTime(), error: 'down' });
    expect(await probe.run('k', 1000, live, { isValue: isString })).toMatchObject({
      source: 'cache',
      error: 'down',
    });
    await cache.set('k', { checked_at: new FakeClock().now().getTime(), value: 'kept' });
    expect(await probe.run('k', 1000, live, { isValue: isString })).toMatchObject({
      value: 'kept',
      source: 'cache',
    });
  });
});
