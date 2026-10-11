// Registry discovery follows npm's effective configuration and keeps explicit overrides authoritative.
import { describe, expect, it } from 'vitest';

import { NpmRegistryLocator } from '../../../../src/adapters/registry/npm-config.js';
import { FakeProcess } from '../../../fakes/fake-process.js';

describe('npm registry discovery', () => {
  it('uses one npm configuration read per package and retains a bad override instead of hiding it', async () => {
    const process = new FakeProcess().always({
      code: 0,
      stdout:
        '@angelmsger:registry=https://npm.example.com/\nregistry=https://registry.npmjs.org/\n',
      stderr: '',
    });
    const registry = new NpmRegistryLocator(process, {}, '/home');
    const first = await registry.resolve('@angelmsger/fx');
    expect(first).toEqual({ registry: 'https://npm.example.com/', source: 'npm_scope' });
    expect(await registry.resolve('@angelmsger/fx')).toBe(first);
    expect(process.calls).toHaveLength(1);
    process.clear();
    const count = process.calls.length;
    expect(
      await new NpmRegistryLocator(
        process,
        { FX_REGISTRY: 'https://user:secret@npm.example.com/' },
        '/home',
      ).resolve('@angelmsger/fx'),
    ).toEqual({ registry: null, source: 'environment' });
    expect(process.calls).toHaveLength(count);
  });

  it('uses npm defaults when unscoped and falls back to npmjs when npm configuration is unreadable', async () => {
    const process = new FakeProcess().always({
      code: 0,
      stdout: '@angelmsger:registry=undefined\nregistry=https://npm.example.com/\n',
      stderr: '',
    });
    expect(await new NpmRegistryLocator(process, {}, '/home').resolve('@angelmsger/fx')).toEqual({
      registry: 'https://npm.example.com/',
      source: 'npm_default',
    });
    process.clear().always({
      code: 0,
      stdout:
        '@angelmsger:registry=https://npm.example.com/\n?token=fixture\nregistry=https://registry.npmjs.org/\n',
      stderr: '',
    });
    expect(await new NpmRegistryLocator(process, {}, '/home').resolve('@angelmsger/fx')).toEqual({
      registry: null,
      source: 'unavailable',
    });
    process.clear().always({ code: 1, stdout: '', stderr: 'npm configuration could not load' });
    const unavailable = new NpmRegistryLocator(process, {}, '/home');
    expect(await unavailable.resolve('@angelmsger/fx')).toEqual({
      registry: 'https://registry.npmjs.org/',
      source: 'distribution_default',
    });
  });
});
