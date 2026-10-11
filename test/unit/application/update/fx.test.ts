import { describe, expect, it } from 'vitest';

import { CachedProbe } from '../../../../src/application/update/check.js';
import { FxUpdateCheck, fxUpdateKey } from '../../../../src/application/update/fx.js';
import { fxOutdated } from '../../../../src/application/update/notices.js';
import { FX_UPDATE_TTL_MS } from '../../../../src/application/update/policy.js';
import { FakeCache } from '../../../fakes/fake-cache.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeRegistry } from '../../../fakes/fake-registry.js';

const REGISTRY = 'https://npm.example.com';

function stage(answer: string | Error = '0.2.0') {
  const cache = new FakeCache();
  const clock = new FakeClock();
  const registry = new FakeRegistry(answer);
  const check = new FxUpdateCheck(new CachedProbe(cache, clock), () => registry);
  const input = { current: '0.1.0', packageName: '@angelmsger/fx', registry: REGISTRY };
  return { cache, clock, registry, check, input };
}

describe('CachedProbe', () => {
  it('asks once per window, remembers a failure for the window too, and obeys force', async () => {
    const s = stage(new Error('registry responded 503'));
    const first = await s.check.execute(s.input);
    expect(first).toMatchObject({
      behind: false,
      latest: null,
      source: 'live',
      error: 'registry responded 503',
    });
    const second = await s.check.execute(s.input);
    expect(second.source).toBe('cache');
    expect(second.error).toBe('registry responded 503');
    expect(s.registry.calls).toBe(1);
    s.registry.set('0.2.0');
    expect((await s.check.execute({ ...s.input, force: true })).source).toBe('live');
    s.clock.advance(FX_UPDATE_TTL_MS + 1);
    await s.check.execute(s.input);
    expect(s.registry.calls).toBe(3);
  });
});

describe('FxUpdateCheck', () => {
  it('is behind when the registry names a newer release', async () => {
    const s = stage('0.2.0');
    expect(await s.check.execute(s.input)).toMatchObject({
      current: '0.1.0',
      latest: '0.2.0',
      behind: true,
      registry: REGISTRY,
      source: 'live',
    });
    expect(fxOutdated(await s.check.execute(s.input))).toMatchObject({
      code: 'FX_OUTDATED',
      message: 'fx 0.1.0 is behind 0.2.0',
      nextSteps: ['fx self update --yes', 'fx skill install'],
    });
  });

  it('is not behind when current, when the newest is a prerelease, or when latest is unknown', async () => {
    expect((await stage('0.1.0').check.execute(stage().input)).behind).toBe(false);
    expect((await stage('0.2.0-beta.1').check.execute(stage().input)).behind).toBe(false);
    const s = stage(new Error('offline'));
    const verdict = await s.check.execute(s.input);
    expect(verdict.behind).toBe(false);
    expect(fxOutdated(verdict)).toBeUndefined();
  });

  it('skips a development build and a build without a registry, without touching the registry or the cache', async () => {
    const s = stage('9.9.9');
    expect(await s.check.execute({ ...s.input, current: '0.0.0' })).toMatchObject({
      source: 'skipped',
      behind: false,
    });
    expect(await s.check.execute({ ...s.input, current: '0.1.0-dev.3' })).toMatchObject({
      source: 'skipped',
    });
    expect(await s.check.execute({ ...s.input, registry: null })).toMatchObject({
      source: 'skipped',
    });
    expect(s.registry.calls).toBe(0);
    expect(s.cache.entries.size).toBe(0);
  });

  it('does not reuse metadata from a different configured registry', async () => {
    const s = stage('0.2.0');
    await s.check.execute(s.input);
    s.registry.set('0.3.0');
    expect(
      await s.check.execute({ ...s.input, registry: 'https://other.example.com/' }),
    ).toMatchObject({ latest: '0.3.0', source: 'live' });
  });

  it('markCurrent settles the window on the version just installed', async () => {
    const s = stage('0.2.0');
    await s.check.markCurrent(s.input, '0.2.0');
    const verdict = await s.check.execute({ ...s.input, current: '0.2.0' });
    expect(verdict).toMatchObject({ behind: false, latest: '0.2.0', source: 'cache' });
    expect(s.registry.calls).toBe(0);
    expect(s.cache.entries.has(fxUpdateKey(s.input))).toBe(true);
  });
});
