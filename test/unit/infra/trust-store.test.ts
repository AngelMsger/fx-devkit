import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fingerprint } from '../../../src/domain/toolchain/trust.js';
import { FileLock } from '../../../src/infra/lock.js';
import { FileTrustStore } from '../../../src/infra/trust-store.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { tempDir } from '../../temp.js';

describe('FileTrustStore', () => {
  it('retains every concurrently approved vector after reopening the store', async () => {
    const home = tempDir('fx-trust-concurrent-');
    const store = new FileTrustStore(home, new FakeClock(), new FileLock(home));
    const vectors = Array.from({ length: 20 }, (_, i) => fingerprint(['tool', String(i)]));
    await Promise.all(vectors.map((key, i) => store.trust('fx', key, `tool ${i}`)));
    const reopened = new FileTrustStore(home, new FakeClock(), new FileLock(home));
    expect((await reopened.list('fx')).map((entry) => entry.fingerprint).sort()).toEqual(
      [...vectors].sort(),
    );
  });

  it('round-trips fingerprints per workspace in trust.yaml', async () => {
    const home = tempDir('fx-home-');
    const store = new FileTrustStore(home, new FakeClock(), new FileLock(home));
    expect(await store.isTrusted('fx', 'abc')).toBe(false);
    await store.trust('fx', 'abc', 'bitbucket-cli auth');
    expect(await store.isTrusted('fx', 'abc')).toBe(true);
    expect(await store.isTrusted('other', 'abc')).toBe(false);
    expect(await store.list('fx')).toEqual([
      { fingerprint: 'abc', label: 'bitbucket-cli auth', trusted_at: '2026-09-01T00:00:00.000Z' },
    ]);
    expect(store.path()).toBe(path.join(home, 'trust.yaml'));
  });
});
