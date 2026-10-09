import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileLocalLayerStore } from '../../../src/infra/local-store.js';
import { localLayerPath } from '../../../src/infra/workspace-home.js';
import { tempDir } from '../../temp.js';

const home = (): string => tempDir('fx-home-');

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

  it('serializes independent store instances without losing sibling local fields', async () => {
    const dir = home();
    const first = new FileLocalLayerStore(dir);
    const second = new FileLocalLayerStore(dir);
    await first.write('fx', { scope: { envs: ['dev'], repos: ['api'] }, hooks: { enabled: true } });
    await Promise.all([
      first.update('fx', async (current) => ({
        ...current,
        scope: { ...current.scope, repos: ['web'] },
      })),
      second.update('fx', async (current) => ({
        ...current,
        scope: { ...current.scope, envs: ['test'] },
      })),
    ]);
    expect(await first.read('fx')).toEqual({
      scope: { envs: ['test'], repos: ['web'] },
      hooks: { enabled: true },
    });
    await expect(
      first.update('fx', () => {
        throw new Error('invalid proposal');
      }),
    ).rejects.toThrow('invalid proposal');
    expect(await second.read('fx')).toEqual({
      scope: { envs: ['test'], repos: ['web'] },
      hooks: { enabled: true },
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
