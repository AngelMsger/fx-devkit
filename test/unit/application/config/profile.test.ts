import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigExport } from '../../../../src/application/config/export.js';
import { ConfigImport } from '../../../../src/application/config/import.js';
import { providerCatalog } from '../../../../src/composition/registry.js';
import type { Lock } from '../../../../src/ports/lock.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLocalStore } from '../../../fakes/fake-local-store.js';

// A person's address, not a git URL's user@host.
const EMAIL = /[A-Za-z0-9._%+-]+@(?!git\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const write = { dryRun: false, posture: { readOnly: false, source: 'default' as const } };
const manifestDirFor = (name: string) => path.resolve('/fake/.fx/workspaces', name, 'source');
const lock: Lock = { acquire: async () => ({ release: async () => {} }) };
const cliVersion = '1.0.0';

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
  return {
    config,
    localStore,
    clock: new FakeClock(),
    fs: FakeFs.from({}),
    manifestDirFor,
    lock,
    cliVersion,
    providers: providerCatalog(),
  };
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
      fs: FakeFs.from({}),
      manifestDirFor,
      lock,
      cliVersion,
      providers: providerCatalog(),
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
      "fx init /ws/lab --name lab --from '<source>'",
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
    const fresh = {
      config: new FakeConfigStore({}),
      localStore: new FakeLocalStore(),
      fs: FakeFs.from({}),
      manifestDirFor,
      lock,
      cliVersion,
      providers: providerCatalog(),
    };
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

  it('retains registrations absent from a profile and shows what still needs preparing', async () => {
    const s = stage();
    const text = JSON.stringify({
      fx_profile: 1,
      config: { workspaces: { new: { root: '/ws/new', source: '/sources/new' } } },
    });
    const preview = await new ConfigImport(s).execute({ ...write, text, dryRun: true });
    expect(preview.registrations).toEqual([
      expect.objectContaining({ name: 'fx', action: 'retained', preparation: 'manifest_missing' }),
      expect.objectContaining({ name: 'lab', action: 'retained', preparation: 'manifest_missing' }),
      expect.objectContaining({ name: 'new', action: 'created', preparation: 'manifest_missing' }),
    ]);
    expect(s.config.writes).toBe(0);
    await new ConfigImport(s).execute({ ...write, text });
    expect(Object.keys((await s.config.read()).workspaces ?? {})).toEqual(['fx', 'lab', 'new']);
  });

  it('rejects relocation, source rebinding, duplicate roots, invalid defaults and orphaned layers before writes', async () => {
    const cases = [
      [{ workspaces: { lab: { root: '/moved/lab' } } }, {}, 'CONFIG_IMPORT_WORKSPACE_CONFLICT'],
      [
        { workspaces: { lab: { root: '/ws/lab', source: '/new-source' } } },
        {},
        'CONFIG_IMPORT_WORKSPACE_CONFLICT',
      ],
      [{ workspaces: { alias: { root: '/ws/lab' } } }, {}, 'WORKSPACE_ROOT_TAKEN'],
      [{ default_workspace: 'typo' }, {}, 'WORKSPACE_DEFAULT_INVALID'],
      [{}, { orphan: { scope: { repos: [] } } }, 'CONFIG_IMPORT_WORKSPACE_UNKNOWN'],
    ] as const;
    for (const [config, workspaces, code] of cases) {
      const s = stage();
      const text = JSON.stringify({ fx_profile: 1, config, workspaces });
      await expect(new ConfigImport(s).execute({ ...write, text })).rejects.toMatchObject({ code });
      expect(s.config.writes).toBe(0);
      expect(s.localStore.writes).toEqual([]);
    }
  });

  it('does not prescribe reinitialization of an already prepared unchanged workspace', async () => {
    const s = stage();
    for (const name of ['fx', 'lab'])
      await s.fs.writeText(
        path.join(manifestDirFor(name), 'manifest/workspace.yaml'),
        'schema_version: 2\ndefaults: { branch: main }\nrepos:\n  - { name: fx-example-api, upstream: https://git.example.com/team/api.git }\n',
      );
    const { text } = await new ConfigExport(s).execute();
    const result = await new ConfigImport(s).execute({ ...write, text });
    expect(result.written).toBe(false);
    expect(result.next_steps).toEqual([]);
    expect(result.registrations.every((r) => r.preparation === 'unchanged')).toBe(true);
  });

  it('pins relative roots to their absolute identity and preserves an omitted source', async () => {
    const s = stage();
    const root = path.resolve('portable workspace');
    await s.config.update((current) => ({
      ...current,
      workspaces: { ...current.workspaces, portable: { root, source: '/source/portable' } },
    }));
    const text = JSON.stringify({
      fx_profile: 1,
      config: { workspaces: { portable: { root: 'portable workspace' } } },
    });
    const result = await new ConfigImport(s).execute({ ...write, text });
    expect(result.config).toBe('unchanged');
    expect((await s.config.read()).workspaces?.['portable']).toEqual({
      root,
      source: '/source/portable',
    });
    const fresh = JSON.stringify({
      fx_profile: 1,
      config: { workspaces: { fresh: { root: 'new workspace' } } },
    });
    await new ConfigImport(s).execute({ ...write, text: fresh });
    expect((await s.config.read()).workspaces?.['fresh']?.root).toBe(path.resolve('new workspace'));
  });

  it.each(['unregister', 'rebind'])(
    'refuses stale layer writes after a concurrent %s',
    async (operation) => {
      const s = stage();
      let released = false;
      const racing: Lock = {
        acquire: async () => {
          await s.config.update((current) => {
            const workspaces = { ...current.workspaces };
            if (operation === 'unregister') delete workspaces['fx'];
            else workspaces['fx'] = { ...workspaces['fx']!, source: '/replacement-source' };
            return { ...current, default_workspace: 'lab', workspaces };
          });
          return {
            release: async () => {
              released = true;
            },
          };
        },
      };
      const text = JSON.stringify({
        fx_profile: 1,
        config: {},
        workspaces: { fx: { scope: { repos: [] } } },
      });
      await expect(
        new ConfigImport({ ...s, lock: racing }).execute({ ...write, text }),
      ).rejects.toMatchObject({ code: 'CONFIG_IMPORT_CHANGED' });
      expect(s.localStore.writes).toEqual([]);
      expect(released).toBe(true);
    },
  );

  it('takes no lifecycle lease for a preview and performs no writes when a lease is busy', async () => {
    const s = stage();
    let acquired = 0;
    const busy: Lock = {
      acquire: async () => {
        acquired += 1;
        return null;
      },
    };
    const text = JSON.stringify({
      fx_profile: 1,
      config: {},
      workspaces: { fx: { scope: { repos: [] } } },
    });
    await new ConfigImport({ ...s, lock: busy }).execute({ ...write, text, dryRun: true });
    expect(acquired).toBe(0);
    await expect(
      new ConfigImport({ ...s, lock: busy }).execute({ ...write, text }),
    ).rejects.toMatchObject({ code: 'LOCK_BUSY' });
    expect(s.config.writes).toBe(0);
    expect(s.localStore.writes).toEqual([]);
  });

  it('rejects imported layers that would make a prepared workspace unusable', async () => {
    const s = stage();
    await s.fs.writeText(
      path.join(manifestDirFor('lab'), 'manifest/workspace.yaml'),
      'schema_version: 2\ndefaults: { branch: main }\nrepos:\n  - { name: api, path: api, upstream: https://git.example.com/team/api.git }\n',
    );
    const text = JSON.stringify({
      fx_profile: 1,
      config: {},
      workspaces: { lab: { repos: [{ name: 'local-shadow', path: 'api' }] } },
    });
    await expect(new ConfigImport(s).execute({ ...write, text })).rejects.toMatchObject({
      code: 'LOCAL_INVALID',
    });
    expect(s.localStore.writes).toEqual([]);
    expect(s.config.writes).toBe(0);
  });
});
