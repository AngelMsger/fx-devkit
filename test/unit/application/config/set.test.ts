import { describe, expect, it } from 'vitest';

import { SetConfig } from '../../../../src/application/config/set.js';
import { UnsetConfig } from '../../../../src/application/config/unset.js';
import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';

const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };

describe('SetConfig', () => {
  it('writes a validated value and reports what changed', async () => {
    const store = new FakeConfigStore({ format: 'human' });
    const result = await new SetConfig(store).execute({
      key: 'format',
      value: 'json',
      dryRun: false,
      posture: writable,
    });
    expect(result).toEqual({
      path: store.path(),
      key: 'format',
      before: 'human',
      after: 'json',
      written: true,
    });
    expect((await store.read()).format).toBe('json');
  });

  it('parses booleans and lists into their stored shape', async () => {
    const store = new FakeConfigStore();
    await new SetConfig(store).execute({
      key: 'read_only',
      value: 'yes',
      dryRun: false,
      posture: writable,
    });
    await new SetConfig(store).execute({
      key: 'agents',
      value: 'a, b',
      dryRun: false,
      posture: writable,
    });
    expect(await store.read()).toEqual({ read_only: true, agents: ['a', 'b'] });
  });

  it('rejects a value outside the enum or an unparseable boolean without writing', async () => {
    const store = new FakeConfigStore();
    const set = new SetConfig(store);
    await expect(
      set.execute({ key: 'format', value: 'xml', dryRun: false, posture: writable }),
    ).rejects.toMatchObject({ category: 'usage', code: 'CONFIG_VALUE_INVALID' });
    await expect(
      set.execute({ key: 'read_only', value: 'maybe', dryRun: false, posture: writable }),
    ).rejects.toMatchObject({ code: 'CONFIG_VALUE_INVALID' });
    expect(store.writes).toBe(0);
  });

  it('returns the plan under --dry-run and touches nothing', async () => {
    const store = new FakeConfigStore();
    const result = await new SetConfig(store).execute({
      key: 'format',
      value: 'json',
      dryRun: true,
      posture: locked,
    });
    expect(result).toMatchObject({ before: null, after: 'json', written: false });
    expect(store.writes).toBe(0);
  });

  it('refuses to write under read-only posture', async () => {
    const store = new FakeConfigStore();
    await expect(
      new SetConfig(store).execute({
        key: 'format',
        value: 'json',
        dryRun: false,
        posture: locked,
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(store.writes).toBe(0);
  });
});

describe('UnsetConfig', () => {
  it('removes the key and reports the previous value', async () => {
    const store = new FakeConfigStore({ format: 'json', user: 'alice' });
    const result = await new UnsetConfig(store).execute({
      key: 'format',
      dryRun: false,
      posture: writable,
    });
    expect(result).toEqual({ path: store.path(), key: 'format', before: 'json', written: true });
    expect(await store.read()).toEqual({ user: 'alice' });
  });

  it('is a no-op that still reports when the key was not set', async () => {
    const store = new FakeConfigStore();
    const result = await new UnsetConfig(store).execute({
      key: 'user',
      dryRun: false,
      posture: writable,
    });
    expect(result).toMatchObject({ before: null, written: false });
    expect(store.writes).toBe(0);
  });
});
