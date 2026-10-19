import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigExport } from '../../../../src/application/config/export.js';
import {
  ConfigImport,
  type ConfigImportDeps,
  type ConfigImportInput,
  type ConfigImportOutput,
} from '../../../../src/application/config/import.js';
import { providerCatalog } from '../../../../src/composition/registry.js';
import { shellLine } from '../../../../src/domain/shell.js';
import type { ConfigFile } from '../../../../src/ports/stores.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLocalStore } from '../../../fakes/fake-local-store.js';
import { FakeLock } from '../../../fakes/fake-lock.js';

// A person's address, not a git URL's user@host.
const EMAIL = /[A-Za-z0-9._%+-]+@(?!git\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const write = { dryRun: false, posture: { readOnly: false, source: 'default' as const } };
const manifestDirFor = (name: string) => path.resolve('/fake/.fx/workspaces', name, 'source');
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
    lock: new FakeLock(),
    cliVersion,
    providers: providerCatalog(),
  };
}

// Another machine's stores, for the profile exported from `stage()` to land on.
function machine(config: ConfigFile = {}) {
  return {
    config: new FakeConfigStore(config),
    localStore: new FakeLocalStore(),
    fs: FakeFs.from({}),
    manifestDirFor,
    lock: new FakeLock(),
    cliVersion,
    providers: providerCatalog(),
  };
}

const exported = async (): Promise<string> => (await new ConfigExport(stage()).execute()).text;

const PROFILE = path.resolve('/exchange/profile.yaml');

// Places the profile where the import is told to read it.
async function importProfile(
  deps: ConfigImportDeps,
  text: string,
  intent: Omit<ConfigImportInput, 'file'> = write,
): Promise<ConfigImportOutput> {
  await deps.fs.writeText(PROFILE, text);
  return new ConfigImport(deps).execute({ ...intent, file: PROFILE });
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

  it('previews what an import would change and prepare, without writing', async () => {
    const target = machine({ format: 'json', user: 'bob' });
    const dry = await importProfile(target, await exported(), { ...write, dryRun: true });
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
      shellLine([
        ...['fx', 'init', path.resolve('/ws/fx'), '--name', 'fx'],
        ...['--from', 'ssh://git@git.example.com:12345/fx/fx-workspace.git'],
      ]),
      shellLine(['fx', 'init', path.resolve('/ws/lab'), '--name', 'lab', '--from', '<source>']),
    ]);
    expect(target.config.writes).toBe(0);
    expect(target.localStore.writes).toEqual([]);
  });

  it('imports by merging config and replacing layers', async () => {
    const target = machine({ format: 'json', user: 'bob' });
    const done = await importProfile(target, await exported());
    expect(done.written).toBe(true);
    expect(await target.config.read()).toMatchObject({
      format: 'json',
      user: 'alice',
      default_workspace: 'fx',
    });
    expect((await target.localStore.read('fx')).scope?.envs).toEqual(['test']);
  });

  it('finds nothing to change when the same profile is imported again', async () => {
    const target = machine({ format: 'json', user: 'bob' });
    const text = await exported();
    await importProfile(target, text);
    expect(await importProfile(target, text)).toMatchObject({
      config: 'unchanged',
      workspaces: [
        { name: 'fx', action: 'unchanged' },
        { name: 'lab', action: 'unchanged' },
      ],
    });
  });

  it('refuses a read-only import only when it has something to write', async () => {
    const locked = { ...write, posture: { readOnly: true, source: 'env' as const } };
    const text = await exported();
    const fresh = machine();
    await expect(importProfile(fresh, text, locked)).rejects.toMatchObject({
      code: 'READONLY_BLOCKED',
    });
    expect(fresh.config.writes).toBe(0);
    expect(fresh.localStore.writes).toEqual([]);
    const current = machine();
    await importProfile(current, text);
    await expect(importProfile(current, text, locked)).resolves.toMatchObject({ written: false });
  });

  it.each([
    { document: 'a profile version it does not know', text: 'fx_profile: 2\nconfig: {}\n' },
    {
      document: 'a setting outside its vocabulary',
      text: 'fx_profile: 1\nconfig: { format: bogus }\n',
    },
    { document: 'text that is not YAML', text: ': not yaml: [' },
  ])('refuses $document', async ({ text }) => {
    const target = machine();
    await expect(importProfile(target, text)).rejects.toMatchObject({
      code: 'CONFIG_IMPORT_INVALID',
    });
    expect(target.config.writes).toBe(0);
  });

  it('refuses a workspace name that would leave the personal directory', async () => {
    const target = machine();
    const traversal = 'fx_profile: 1\nconfig: {}\nworkspaces: { "../../tmp/owned": {} }\n';
    await expect(importProfile(target, traversal)).rejects.toMatchObject({
      code: 'WORKSPACE_NAME_INVALID',
    });
    expect(target.config.writes).toBe(0);
    expect(target.localStore.writes).toEqual([]);
  });

  it('retains registrations absent from a profile and shows what still needs preparing', async () => {
    const s = stage();
    const text = JSON.stringify({
      fx_profile: 1,
      config: { workspaces: { new: { root: '/ws/new', source: '/sources/new' } } },
    });
    const preview = await importProfile(s, text, { ...write, dryRun: true });
    expect(preview.registrations).toEqual([
      expect.objectContaining({ name: 'fx', action: 'retained', preparation: 'manifest_missing' }),
      expect.objectContaining({ name: 'lab', action: 'retained', preparation: 'manifest_missing' }),
      expect.objectContaining({ name: 'new', action: 'created', preparation: 'manifest_missing' }),
    ]);
    expect(s.config.writes).toBe(0);
    await importProfile(s, text);
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
      await expect(importProfile(s, text)).rejects.toMatchObject({ code });
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
    const result = await importProfile(s, text);
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
    const result = await importProfile(s, text);
    expect(result.config).toBe('unchanged');
    expect((await s.config.read()).workspaces?.['portable']).toEqual({
      root,
      source: '/source/portable',
    });
    const fresh = JSON.stringify({
      fx_profile: 1,
      config: { workspaces: { fresh: { root: 'new workspace' } } },
    });
    await importProfile(s, fresh);
    expect((await s.config.read()).workspaces?.['fresh']?.root).toBe(path.resolve('new workspace'));
  });

  it.each(['unregister', 'rebind'])(
    'refuses stale layer writes after a concurrent %s',
    async (operation) => {
      const s = stage();
      const racing = new FakeLock().onAcquire(async () => {
        await s.config.update((current) => {
          const workspaces = { ...current.workspaces };
          if (operation === 'unregister') delete workspaces['fx'];
          else workspaces['fx'] = { ...workspaces['fx']!, source: '/replacement-source' };
          return { ...current, default_workspace: 'lab', workspaces };
        });
      });
      const text = JSON.stringify({
        fx_profile: 1,
        config: {},
        workspaces: { fx: { scope: { repos: [] } } },
      });
      await expect(
        importProfile({ ...s, lock: racing, commandShell: 'cmd' }, text),
      ).rejects.toMatchObject({
        code: 'CONFIG_IMPORT_CHANGED',
        nextSteps: ['fx ^"workspace^" ^"show^" ^"fx^"'],
      });
      expect(s.localStore.writes).toEqual([]);
      expect(racing.requests).not.toEqual([]);
      expect(racing.unreleased()).toEqual([]);
    },
  );

  it('takes no lifecycle lease for a preview and performs no writes when a lease is busy', async () => {
    const s = stage();
    const busy = new FakeLock().busy();
    const text = JSON.stringify({
      fx_profile: 1,
      config: {},
      workspaces: { fx: { scope: { repos: [] } } },
    });
    await importProfile({ ...s, lock: busy }, text, { ...write, dryRun: true });
    expect(busy.requests).toEqual([]);
    await expect(importProfile({ ...s, lock: busy }, text)).rejects.toMatchObject({
      code: 'LOCK_BUSY',
    });
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
    await expect(importProfile(s, text)).rejects.toMatchObject({
      code: 'LOCAL_INVALID',
    });
    expect(s.localStore.writes).toEqual([]);
    expect(s.config.writes).toBe(0);
  });

  it('refuses a profile file that does not exist and writes nothing', async () => {
    const s = stage();
    await expect(
      new ConfigImport(s).execute({ ...write, file: path.resolve('/exchange/absent.yaml') }),
    ).rejects.toMatchObject({
      code: 'CONFIG_IMPORT_NOT_FOUND',
      nextSteps: ['fx config export -o profile.yaml'],
    });
    expect(s.config.writes).toBe(0);
    expect(s.localStore.writes).toEqual([]);
  });
});
