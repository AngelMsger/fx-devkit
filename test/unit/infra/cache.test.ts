// File-symlink cases require a POSIX host; junction behavior has native Windows coverage.
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileCache } from '../../../src/infra/cache.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { tempDir } from '../../temp.js';

describe('FileCache', () => {
  it('round-trips within the ttl and forgets past it', async () => {
    const home = tempDir('fx-cache-');
    const clock = new FakeClock();
    const cache = new FileCache(home, clock);
    expect(await cache.get('never-set')).toBeUndefined();
    await cache.set('update/fx', { a: 1 }, 1000);
    expect(await cache.get('update/fx')).toEqual({ a: 1 });
    clock.advance(1001);
    expect(await cache.get('update/fx')).toBeUndefined();
  });

  it('is a miss, not an error, when the cache is not a directory or the entry is not a regular file', async () => {
    const home = tempDir('fx-cache-');
    writeFileSync(path.join(home, 'cache'), 'not a directory');
    const blocked = new FileCache(home, new FakeClock());
    await expect(blocked.set('k', 1, 1000)).resolves.toBeUndefined();
    expect(await blocked.get('k')).toBeUndefined();
    const other = tempDir('fx-cache-');
    mkdirSync(path.join(other, 'cache', 'k.json'), { recursive: true });
    const dirEntry = new FileCache(other, new FakeClock());
    expect(await dirEntry.get('k')).toBeUndefined();
    await expect(dirEntry.set('k', 1, 1000)).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'never follows a symlink: a linked entry is replaced, not written through, and a linked directory is left alone',
    async () => {
      const home = tempDir('fx-cache-');
      const outside = path.join(home, 'outside.txt');
      writeFileSync(outside, 'precious');
      mkdirSync(path.join(home, 'cache'));
      symlinkSync(outside, path.join(home, 'cache', 'k.json'));
      const cache = new FileCache(home, new FakeClock());
      expect(await cache.get('k')).toBeUndefined();
      await cache.set('k', 1, 1000);
      expect(readFileSync(outside, 'utf8')).toBe('precious');
      expect(lstatSync(path.join(home, 'cache', 'k.json')).isSymbolicLink()).toBe(false);
      expect(await cache.get('k')).toBe(1);

      const linked = tempDir('fx-cache-');
      const elsewhere = tempDir('fx-elsewhere-');
      symlinkSync(elsewhere, path.join(linked, 'cache'));
      const throughLink = new FileCache(linked, new FakeClock());
      await throughLink.set('k', 1, 1000);
      expect(readdirSync(elsewhere)).toEqual([]);
      writeFileSync(
        path.join(elsewhere, 'k.json'),
        JSON.stringify({ expires_at: 9e15, value: 'planted' }),
      );
      expect(await throughLink.get('k')).toBeUndefined();
    },
  );
});
