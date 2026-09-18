// Installation audit and removal decisions remain useful after tool definitions disappear.
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkInstallations } from '../../../../src/application/doctor/installations.js';
import { ToolInstall } from '../../../../src/application/tool/install.js';
import { ToolInstalled } from '../../../../src/application/tool/installed.js';
import { providerCatalog } from '../../../../src/composition/registry.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { loadTools, loadWorkspace } from '../../../../src/domain/manifest/loader.js';
import { resolveTools } from '../../../../src/domain/toolchain/resolve.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeInstaller } from '../../../fakes/fake-installer.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { fakeToolAudit, FakeToolHistory } from '../../../fakes/fake-tool-history.js';

const baseline = `schema_version: 2
tools: [{name: sample, install: [{via: npm, spec: '@example/sample'}]}]`;
const workspace = `schema_version: 2
providers: {code-host: {provider: local-git, vars: {host: /host}}}
defaults: {upstream_project: team, branch: main}
projects: {team: {label: Team, contact: fixture}}
repos: [{name: sample, desc: Fixture}]`;
const posture = { readOnly: false, source: 'default' } as const;
function fixture() {
  loadWorkspace(workspace, { cliVersion: '1.0.0' });
  const history = new FakeToolHistory();
  const audit = fakeToolAudit(history);
  const process = new FakeProcess().always({ code: 0, stdout: '1.2.3', stderr: '' });
  process.binaries.add('sample');
  const loaded = loadTools(baseline, undefined, { cliVersion: '1.0.0' });
  const tools = resolveTools(loaded.doc, loaded.provenance);
  const install = new ToolInstall(FakeInstaller.family(['npm']), process, audit);
  const config = new FakeConfigStore({ workspaces: { first: { root: '/first' } } });
  const fs = FakeFs.from({ '/first/manifest/workspace.yaml': workspace });
  const inventory = new ToolInstalled({
    history,
    config,
    fs,
    process,
    bundledTools: () => baseline,
    manifestDirFor: (name) => path.resolve('/', name),
    providers: providerCatalog(),
    cliVersion: '1.0.0',
  });
  return { history, audit, process, tools, install, config, fs, inventory };
}
const request = { names: ['sample'], update: false, dryRun: false, posture };
async function recorded(f: ReturnType<typeof fixture>, scope: string | null = 'first') {
  const start = await f.audit.start({
    operation: 'install',
    workspace: scope,
    name: 'sample',
    binary: 'sample',
    via: 'npm',
    spec: '@example/sample',
    vector: ['npm', 'install', '-g', '@example/sample@latest'],
    binary_path_before: null,
  });
  await f.audit.checkpoint(start, {
    event: 'finished',
    code: 0,
    version_after: '1.2.3',
    binary_path: (await f.process.which('sample')) ?? null,
    failure_code: null,
  });
  return start;
}
async function disable(f: ReturnType<typeof fixture>) {
  await f.fs.writeText(
    '/first/manifest/tools.yaml',
    'schema_version: 2\ntools: [{name: sample, enabled: false}]',
  );
}

describe('installation audit', () => {
  it('checkpoints before execution, keeps updates and never journals dry runs or read-only refusals', async () => {
    const f = fixture();
    f.process.run = async (vector) => {
      if (vector[0] === 'npm') expect(f.history.entries.at(-1)?.event).toBe('started');
      return { code: 0, stdout: '1.2.3', stderr: '' };
    };
    await f.install.execute({ ...request, tools: f.tools, dryRun: true });
    await expect(
      f.install.execute({ ...request, tools: f.tools, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(f.history.entries).toEqual([]);
    await f.install.execute({ ...request, tools: f.tools });
    await f.install.execute({ ...request, tools: f.tools, update: true });
    expect(f.history.entries.map((r) => [r.operation, r.event])).toEqual([
      ['install', 'started'],
      ['install', 'installed'],
      ['install', 'finished'],
      ['update', 'started'],
      ['update', 'installed'],
      ['update', 'finished'],
    ]);
    expect(new Set(f.history.entries.map((r) => r.id)).size).toBe(2);
  });

  it('keeps installer success when the probe throws and retains only stable failure metadata', async () => {
    const f = fixture();
    f.process.run = async (vector) => {
      if (vector[0] === 'sample')
        throw new DevkitError('internal', 'PROCESS_ABORTED', 'token=secret');
      return { code: 0, stdout: 'secret output', stderr: '' };
    };
    await expect(f.install.execute({ ...request, tools: f.tools })).rejects.toMatchObject({
      code: 'PROCESS_ABORTED',
    });
    expect(f.history.entries.at(-1)).toMatchObject({
      event: 'finished',
      code: 0,
      version_after: null,
      failure_code: 'PROCESS_ABORTED',
    });
    expect(JSON.stringify(f.history.entries)).not.toContain('secret');
  });

  it('preserves failed install evidence without claiming success and stops before execution if the ledger is unwritable', async () => {
    const f = fixture();
    f.process.clear().always({ code: 7, stdout: '', stderr: 'secret output' });
    await f.install.execute({ ...request, tools: f.tools });
    expect(f.history.entries.map((r) => r.event)).toEqual(['started', 'finished']);
    expect(f.history.entries.at(-1)?.code).toBe(7);
    await disable(f);
    expect(await f.inventory.execute()).toMatchObject([{ state: 'unverified', installed_by: [] }]);
    f.history.append = async () => {
      throw new Error('disk full');
    };
    const calls = f.process.calls.length;
    await expect(f.install.execute({ ...request, tools: f.tools })).rejects.toThrow('disk full');
    expect(f.process.calls).toHaveLength(calls);
  });

  it('redacts credentials and arbitrary URL query parameters before persisting commands', async () => {
    const f = fixture();
    await f.audit.start({
      operation: 'install',
      workspace: null,
      name: 'sample',
      binary: 'sample',
      via: 'npm',
      spec: '@example/sample',
      vector: [
        'npm',
        '--registry',
        'https://user:secret@example.com/?authValue=private',
        '--token',
        'private',
      ],
    });
    const json = JSON.stringify(f.history.entries);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('private');
    expect(json).not.toContain('user:');
  });
});

describe('recorded installations', () => {
  it('does not adopt pre-existing PATH tools and retains history for disabled tools', async () => {
    const f = fixture();
    expect(await f.inventory.execute()).toMatchObject([
      { installation_origin: 'external', recorded: false, uninstall_hint: null },
    ]);
    await recorded(f);
    expect(await f.inventory.execute()).toMatchObject([
      { state: 'required', required_by: ['first'] },
    ]);
    await disable(f);
    expect(await f.inventory.execute()).toMatchObject([
      {
        state: 'unused',
        required_by: [],
        uninstall_hint: expect.stringContaining('manual removal'),
      },
    ]);
    expect(await checkInstallations(f.inventory)).toMatchObject([
      { level: 'warn', coverage: 'checked', evidence: { installation: { state: 'unused' } } },
    ]);
    expect(f.history.entries).toHaveLength(2);
  });

  it('protects a shared package under another name and suppresses suggestions for unreadable manifests', async () => {
    const f = fixture();
    await recorded(f);
    await disable(f);
    await f.config.write({
      workspaces: { first: { root: '/first' }, second: { root: '/second' } },
    });
    expect(await f.inventory.execute()).toMatchObject([
      { state: 'unknown', unknown_workspaces: ['second'] },
    ]);
    await f.fs.writeText('/second/manifest/workspace.yaml', workspace);
    await f.fs.writeText(
      '/second/manifest/tools.yaml',
      `schema_version: 2
tools:
  - {name: sample, enabled: false}
  - {name: renamed, install: [{via: npm, spec: '@example/sample'}]}`,
    );
    expect(await f.inventory.execute()).toMatchObject([
      { state: 'required', required_by: ['second'] },
    ]);
  });

  it('tracks custom tools removed entirely, and re-adding a requirement cancels the suggestion', async () => {
    const f = fixture();
    const start = await f.audit.start({
      operation: 'init',
      workspace: 'first',
      name: 'custom',
      binary: 'custom',
      via: 'brew',
      spec: 'custom',
      vector: ['brew', 'install', 'custom'],
      binary_path_before: null,
    });
    f.process.binaries.add('custom');
    await f.audit.checkpoint(start, {
      event: 'finished',
      code: 0,
      version_after: null,
      binary_path: (await f.process.which('custom'))!,
      failure_code: null,
    });
    expect(await f.inventory.execute()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'custom', state: 'unused' })]),
    );
    await f.fs.writeText(
      '/first/manifest/tools.yaml',
      'schema_version: 2\ntools: [{name: custom, install: [{via: brew}]}]',
    );
    expect(await f.inventory.execute()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'custom', state: 'required' })]),
    );
  });

  it('handles missing binaries, changed paths, standalone installs and interrupted concurrent attempts conservatively', async () => {
    const f = fixture();
    const entry = await recorded(f);
    await disable(f);
    f.process.binaries.delete('sample');
    expect(await f.inventory.execute()).toMatchObject([{ state: 'not_on_path' }]);
    f.process.which = async () => '/different/sample';
    expect(await f.inventory.execute()).toMatchObject([{ state: 'changed' }]);
    f.process.which = async () => entry.binary_path ?? '/fake/bin/sample';
    await recorded(f, null);
    expect(await f.inventory.execute()).toMatchObject([{ state: 'unscoped' }]);
    f.history.entries.splice(0);
    const pending = await f.audit.start({ ...entry, workspace: 'first' });
    await recorded(f);
    expect(pending.event).toBe('started');
    expect(await f.inventory.execute()).toMatchObject([{ state: 'unknown' }]);
  });
});

describe('installation provenance', () => {
  it('preserves external ownership when fx installs over or updates an existing binary', async () => {
    const f = fixture();
    await f.install.execute({ ...request, tools: f.tools });
    await f.install.execute({ ...request, tools: f.tools, update: true });
    expect(f.history.entries.every((event) => event.installation_origin === 'external')).toBe(true);
    expect(f.history.entries[0]?.binary_path_before).toBe('/fake/bin/sample');
    await disable(f);
    expect(await f.inventory.execute()).toMatchObject([
      { installation_origin: 'external', recorded: true, uninstall_hint: null },
    ]);
  });
  it('retains fx origin across later updates after a successful fresh install', async () => {
    const f = fixture();
    f.process.binaries.delete('sample');
    f.process.run = async () => {
      f.process.binaries.add('sample');
      return { code: 0, stdout: '1.2.3', stderr: '' };
    };
    await f.install.execute({ ...request, tools: f.tools });
    await f.install.execute({ ...request, tools: f.tools, update: true });
    expect(f.history.entries.every((event) => event.installation_origin === 'fx')).toBe(true);
    expect(f.history.entries[0]?.binary_path_before).toBeNull();
    expect(await f.inventory.execute()).toMatchObject([{ installation_origin: 'fx' }]);
  });
  it('does not infer ownership from legacy operations or a changed executable path', async () => {
    const f = fixture();
    await recorded(f);
    for (const entry of f.history.entries) {
      delete (entry as { installation_origin?: string }).installation_origin;
      delete (entry as { binary_path_before?: string | null }).binary_path_before;
    }
    await disable(f);
    expect(await f.inventory.execute()).toMatchObject([
      { state: 'unknown', installation_origin: 'unknown', uninstall_hint: null },
    ]);
    await f.install.execute({ ...request, tools: f.tools, update: true });
    expect(f.history.entries.at(-1)?.installation_origin).toBe('unknown');
    f.process.which = async () => '/different/sample';
    expect(await f.inventory.execute()).toMatchObject([
      { installation_origin: 'unknown', uninstall_hint: null },
    ]);
  });
});
