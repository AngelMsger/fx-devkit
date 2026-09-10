import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileConfigStore } from '../../../src/infra/config-store.js';

const home = (): string => mkdtempSync(path.join(tmpdir(), 'fx-home-'));

describe('FileConfigStore', () => {
  it('returns actionable configuration errors for malformed YAML without echoing its contents', async () => {
    const dir = home();
    writeFileSync(path.join(dir, 'config.yaml'), 'user: [private-value\n');
    await expect(new FileConfigStore(dir).read()).rejects.toMatchObject({
      category: 'config',
      code: 'CONFIG_INVALID',
      message: expect.not.stringContaining('private-value'),
      nextSteps: expect.arrayContaining(['fx config list']),
    });
  });
  it('reads an absent file as an empty config', async () => {
    expect(await new FileConfigStore(home()).read()).toEqual({});
  });

  it('round-trips a write and reports its path', async () => {
    const dir = home();
    const store = new FileConfigStore(dir);
    await store.write({ default_workspace: 'fx', workspaces: { fx: { root: '/w/fx' } } });
    expect((await store.read()).workspaces?.['fx']?.root).toBe('/w/fx');
    expect(store.path()).toBe(path.join(dir, 'config.yaml'));
    expect(readFileSync(store.path(), 'utf8')).toContain('default_workspace: fx');
  });

  it('rejects an unknown top-level key as a config error naming the file', async () => {
    const dir = home();
    writeFileSync(path.join(dir, 'config.yaml'), 'defualt_workspace: fx\n');
    await expect(new FileConfigStore(dir).read()).rejects.toMatchObject({
      category: 'config',
      code: 'CONFIG_INVALID',
      message: expect.stringContaining('config.yaml'),
    });
  });

  it('rejects a value of the wrong type', async () => {
    const dir = home();
    writeFileSync(path.join(dir, 'config.yaml'), 'read_only: maybe\n');
    await expect(new FileConfigStore(dir).read()).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('rejects an output format the renderer does not implement', async () => {
    const dir = home();
    writeFileSync(path.join(dir, 'config.yaml'), 'format: bogus\n');
    await expect(new FileConfigStore(dir).read()).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
      message: expect.stringContaining('format'),
    });
  });
});
