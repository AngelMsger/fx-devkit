import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileCache } from '../../../src/infra/cache.js';
import { FileLocalLayerStore } from '../../../src/infra/local-store.js';
import { localLayerPath } from '../../../src/infra/workspace-home.js';
import { FakeClock } from '../../fakes/fake-clock.js';

const home = (): string => mkdtempSync(path.join(tmpdir(), 'fx-home-'));

describe('FileLocalLayerStore', () => {
  it('reads an absent layer as empty and round-trips a write under workspaces/<name>', async () => {
    const dir = home();
    const store = new FileLocalLayerStore(dir);
    expect(await store.read('fx')).toEqual({});
    await store.write('fx', { scope: { repos: ['a'] }, overrides: { a: { branch: 'x' } } });
    expect(store.path('fx')).toBe(localLayerPath(dir, 'fx'));
    expect(readFileSync(store.path('fx'), 'utf8')).toContain('repos:');
    expect(await store.read('fx')).toEqual({
      scope: { repos: ['a'] },
      overrides: { a: { branch: 'x' } },
    });
  });

  it('refuses a layer that copies a shared field', async () => {
    const dir = home();
    mkdirSync(path.join(dir, 'workspaces', 'fx'), { recursive: true });
    writeFileSync(
      path.join(dir, 'workspaces', 'fx', 'local.yaml'),
      'overrides:\n  a: { upstream: x }\n',
    );
    await expect(new FileLocalLayerStore(dir).read('fx')).rejects.toMatchObject({
      code: 'LOCAL_INVALID',
    });
  });
});

describe('FileCache', () => {
  it('returns a value until its ttl passes, then forgets it', async () => {
    const clock = new FakeClock();
    const cache = new FileCache(home(), clock);
    await cache.set('readable/fx/fx-example-api', { state: 'readable' }, 1000);
    expect(await cache.get('readable/fx/fx-example-api')).toEqual({ state: 'readable' });
    clock.advance(1001);
    expect(await cache.get('readable/fx/fx-example-api')).toBeUndefined();
    expect(await cache.get('never-set')).toBeUndefined();
  });
});
