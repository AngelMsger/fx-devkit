import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileLock } from '../../../src/infra/lock.js';
import { FileTrustStore } from '../../../src/infra/trust-store.js';
import { FakeClock } from '../../fakes/fake-clock.js';

const homes: string[] = [];
async function home(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fx-lock-'));
  homes.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('cross-process file locks', () => {
  it('excludes independent instances and releases a lease only once', async () => {
    const dir = await home();
    const a = new FileLock(dir);
    const b = new FileLock(dir);
    const first = await a.acquire({ key: 'resource', waitMs: 0 });
    expect(first).not.toBeNull();
    expect(await b.acquire({ key: 'resource', waitMs: 0 })).toBeNull();
    await first?.release();
    const second = await b.acquire({ key: 'resource', waitMs: 0 });
    expect(second).not.toBeNull();
    await first?.release();
    expect(await a.acquire({ key: 'resource', waitMs: 0 })).toBeNull();
    await second?.release();
  });

  it('serializes independent trust stores without losing approvals', async () => {
    const dir = await home();
    const a = new FileTrustStore(dir, new FakeClock(), new FileLock(dir));
    const b = new FileTrustStore(dir, new FakeClock(), new FileLock(dir));
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? a : b).trust('workspace', `fingerprint-${i}`, `vector-${i}`),
      ),
    );
    expect(await a.list('workspace')).toHaveLength(12);
  });
});
