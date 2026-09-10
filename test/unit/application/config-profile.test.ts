import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigExport } from '../../../src/application/config/export.js';
import { ConfigImport } from '../../../src/application/config/import.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeConfigStore } from '../../fakes/fake-config-store.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeLocalStore } from '../../fakes/fake-local-store.js';

// A person's address, not a git URL's user@host.
const EMAIL = /[A-Za-z0-9._%+-]+@(?!git\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const write = { dryRun: false, posture: { readOnly: false, source: 'default' as const } };

function stage() {
  const config = new FakeConfigStore({
    default_workspace: 'fx',
    workspaces: {
      fx: {
        root: path.resolve('/ws/fx'),
        source: 'ssh://git@git.example.com:12345/fx/fx-workspace.git',
      },
      lab: { root: path.resolve('/ws/lab') },
    },
    user: 'alice',
    agents: ['claude-code'],
  });
  const localStore = new FakeLocalStore(
    new Map([
      [
        'fx',
        {
          scope: { repos: ['fx-example-api'], envs: ['test'] },
          setup: { 'kubectl.kubeconfig@test': { acknowledged: '2026-09-01' } },
        },
      ],
      ['lab', {}],
    ]),
  );
  return { config, localStore, clock: new FakeClock(), fs: FakeFs.from({}) };
}

describe('profile export / import', () => {
  it('exports config and every personal layer, and nothing that must stay behind', async () => {
    const s = stage();
    const { profile, text } = await new ConfigExport(s).execute();
    expect(profile.fx_profile).toBe(1);
    expect(profile.config).toEqual({
      default_workspace: 'fx',
      workspaces: {
        fx: {
          root: path.resolve('/ws/fx'),
          source: 'ssh://git@git.example.com:12345/fx/fx-workspace.git',
        },
        lab: { root: path.resolve('/ws/lab') },
      },
      user: 'alice',
      agents: ['claude-code'],
    });
    expect(Object.keys(profile.workspaces)).toEqual(['fx', 'lab']);
    expect(profile.workspaces['fx']?.scope?.repos).toEqual(['fx-example-api']);
    expect(text).not.toMatch(/trust|cache|password|token/);
    expect(text).not.toMatch(EMAIL);
  });

  it('plans an output file before the write gate and writes it only when allowed', async () => {
    const s = stage();
    const preview = await new ConfigExport(s).execute({
      out: path.resolve('/tmp/profile.yaml'),
      dryRun: true,
      posture: { readOnly: true, source: 'env' },
    });
    expect(preview).toMatchObject({ path: path.resolve('/tmp/profile.yaml'), written: false });
    expect(await s.fs.exists(path.resolve('/tmp/profile.yaml'))).toBe(false);

    await expect(
      new ConfigExport(s).execute({
        out: path.resolve('/tmp/profile.yaml'),
        dryRun: false,
        posture: { readOnly: true, source: 'env' },
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(await s.fs.exists(path.resolve('/tmp/profile.yaml'))).toBe(false);

    const done = await new ConfigExport(s).execute({
      out: path.resolve('/tmp/profile.yaml'),
      dryRun: false,
      posture: { readOnly: false, source: 'default' },
    });
    expect(done.written).toBe(true);
    expect(await s.fs.readText(path.resolve('/tmp/profile.yaml'))).toBe(done.text);
  });

  it('imports by merging config and replacing layers, previews without writing, and refuses garbage', async () => {
    const s = stage();
    const { text } = await new ConfigExport(s).execute();
    const target = {
      config: new FakeConfigStore({ format: 'json', user: 'bob' }),
      localStore: new FakeLocalStore(),
    };
    const dry = await new ConfigImport(target).execute({ ...write, text, dryRun: true });
    expect(dry).toMatchObject({
      config: 'changed',
      // lab's layer is empty, and an empty layer over no file is nothing to write.
      workspaces: [
        { name: 'fx', action: 'created' },
        { name: 'lab', action: 'unchanged' },
      ],
      written: false,
    });
    expect(dry.next_steps).toEqual([
      'fx init /ws/fx --name fx --from ssh://git@git.example.com:12345/fx/fx-workspace.git',
      'fx init /ws/lab --name lab --from <source>',
    ]);
    expect(target.localStore.writes).toEqual([]);
    const done = await new ConfigImport(target).execute({ ...write, text });
    expect(done.written).toBe(true);
    expect(await target.config.read()).toMatchObject({
      format: 'json',
      user: 'alice',
      default_workspace: 'fx',
    });
    expect((await target.localStore.read('fx')).scope?.envs).toEqual(['test']);
    const again = await new ConfigImport(target).execute({ ...write, text });
    expect(again).toMatchObject({
      config: 'unchanged',
      workspaces: [
        { name: 'fx', action: 'unchanged' },
        { name: 'lab', action: 'unchanged' },
      ],
    });
    await expect(
      new ConfigImport(target).execute({
        ...write,
        text,
        posture: { readOnly: true, source: 'env' },
      }),
    ).resolves.toMatchObject({ written: false });
    const fresh = { config: new FakeConfigStore({}), localStore: new FakeLocalStore() };
    await expect(
      new ConfigImport(fresh).execute({
        ...write,
        text,
        posture: { readOnly: true, source: 'env' },
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    await expect(
      new ConfigImport(target).execute({ ...write, text: 'fx_profile: 2\nconfig: {}\n' }),
    ).rejects.toMatchObject({ code: 'CONFIG_IMPORT_INVALID' });
    await expect(
      new ConfigImport(target).execute({
        ...write,
        text: 'fx_profile: 1\nconfig: { format: bogus }\n',
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_IMPORT_INVALID' });
    await expect(
      new ConfigImport(target).execute({ ...write, text: ': not yaml: [' }),
    ).rejects.toMatchObject({ code: 'CONFIG_IMPORT_INVALID' });
    const traversal = 'fx_profile: 1\nconfig: {}\nworkspaces: { "../../tmp/owned": {} }\n';
    await expect(
      new ConfigImport(target).execute({ ...write, text: traversal }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_NAME_INVALID',
    });
  });
});
