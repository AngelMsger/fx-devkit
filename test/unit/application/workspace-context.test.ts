import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WorkspaceContext } from '../../../src/application/workspace-context.js';
import { FakeConfigStore } from '../../fakes/fake-config-store.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeGit } from '../../fakes/fake-git.js';
import { FakeLocalStore } from '../../fakes/fake-local-store.js';
import { FakeReporter } from '../../fakes/fake-reporter.js';

const fixture = (name: string): string =>
  readFileSync(path.resolve('test/fixtures/manifest', name), 'utf8');
const bundled = (): string => readFileSync(path.resolve('defaults/tools.yaml'), 'utf8');
const manifestDirFor = (name: string): string =>
  path.normalize(`/home/.fx/workspaces/${name}/source`);

function fs(): FakeFs {
  const files = FakeFs.from({
    [`${manifestDirFor('fx')}/manifest/workspace.yaml`]: fixture('v1-minimal/workspace.yaml'),
    [`${manifestDirFor('other')}/manifest/workspace.yaml`]: fixture('v2-full/workspace.yaml'),
    [`${manifestDirFor('broken')}/manifest/workspace.yaml`]: fixture('broken/entry.yaml'),
  });
  for (const name of ['fx', 'other', 'broken']) files.mkdir(path.resolve('/ws', name));
  return files;
}

function locate(overrides: {
  cwd?: string;
  name?: string;
  config?: FakeConfigStore;
  fs?: FakeFs;
  git?: FakeGit;
  localStore?: FakeLocalStore;
  reporter?: FakeReporter;
}) {
  const reporter = overrides.reporter ?? new FakeReporter();
  return WorkspaceContext.locate({
    cwd: overrides.cwd ?? path.resolve('/ws/fx/fx-example-api/src'),
    name: overrides.name,
    config:
      overrides.config ??
      new FakeConfigStore({
        default_workspace: 'fx',
        workspaces: {
          fx: { root: path.resolve('/ws/fx') },
          other: { root: path.resolve('/ws/other') },
        },
      }),
    fs: overrides.fs ?? fs(),
    git: overrides.git ?? new FakeGit(),
    localStore: overrides.localStore ?? new FakeLocalStore(),
    bundledTools: bundled,
    cliVersion: '1.0.0',
    reporter,
    manifestDirFor,
  }).then((ctx) => ({ ctx, reporter }));
}

describe('WorkspaceContext.locate', () => {
  it('finds the workspace containing cwd and names it from the registry', async () => {
    const { ctx, reporter } = await locate({});
    expect(ctx.root).toBe(path.normalize(path.resolve('/ws/fx')));
    expect(ctx.name).toBe('fx');
    expect(ctx.manifestDir).toBe(manifestDirFor('fx'));
    expect(ctx.manifest.dir).toBe(manifestDirFor('fx'));
    expect(ctx.workspace.repos.map((r) => r.name)).toEqual([
      'fx-example-api',
      'fx-example-auth',
      'fx-example-docs',
    ]);
    expect(reporter.codes()).toEqual([]);
  });

  it('prefers an explicit --workspace name over cwd', async () => {
    const { ctx } = await locate({ name: 'other' });
    expect(ctx.root).toBe(path.normalize(path.resolve('/ws/other')));
    expect(ctx.workspace.repos.map((r) => r.name)).toEqual(['fx-example-api', 'fx-example-auth']);
  });

  it('rejects an unknown --workspace name with a suggestion', async () => {
    await expect(locate({ name: 'othr' })).rejects.toMatchObject({
      category: 'not_found',
      code: 'WORKSPACE_UNKNOWN',
      hint: expect.stringContaining('other'),
    });
  });

  it('falls back to default_workspace outside any workspace and says so when there are several', async () => {
    const { ctx, reporter } = await locate({ cwd: path.resolve('/elsewhere') });
    expect(ctx.name).toBe('fx');
    expect(reporter.notices).toEqual([
      expect.objectContaining({
        code: 'WORKSPACE_IMPLICIT',
        silence: 'FX_WORKSPACE=fx',
        data: { active: 'fx', available: ['fx', 'other'], override: '--workspace <name>' },
      }),
    ]);
  });

  it('stays quiet about the fallback when only one workspace is registered', async () => {
    const config = new FakeConfigStore({
      default_workspace: 'fx',
      workspaces: { fx: { root: path.resolve('/ws/fx') } },
    });
    const { reporter } = await locate({ cwd: path.resolve('/elsewhere'), config });
    expect(reporter.codes()).toEqual([]);
  });

  it('fails with WORKSPACE_NOT_FOUND when nothing applies', async () => {
    await expect(
      locate({ cwd: path.resolve('/elsewhere'), config: new FakeConfigStore({}) }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
    });
  });

  it('applies the personal layer and reports what did not match', async () => {
    const localStore = FakeLocalStore.with('fx', {
      scope: { repos: ['fx-example-api', 'ghost'] },
      overrides: { phantom: { branch: 'x' } },
    });
    const { ctx, reporter } = await locate({ localStore });
    expect(ctx.workspace.repos.map((r) => r.name)).toEqual(['fx-example-api']);
    expect(ctx.workspace.available).toEqual(['fx-example-auth', 'fx-example-docs']);
    expect(reporter.notices).toEqual([
      expect.objectContaining({
        code: 'LOCAL_OVERRIDE_UNMATCHED',
        data: { unmatched: ['scope.repos.ghost', 'overrides.phantom'] },
      }),
    ]);
  });

  it('reports quarantined manifest entries on every run', async () => {
    const config = new FakeConfigStore({
      workspaces: { broken: { root: path.resolve('/ws/broken') } },
    });
    const { ctx, reporter } = await locate({ cwd: path.resolve('/ws/broken'), config });
    expect(ctx.workspace.repos.map((r) => r.name)).toEqual(['good-one', 'good-two']);
    expect(reporter.notices).toEqual([
      expect.objectContaining({
        code: 'MANIFEST_ENTRY_UNUSABLE',
        data: { dropped: ['repos[1]', 'escapes'] },
      }),
    ]);
  });

  it('exposes the provider bindings', async () => {
    const { ctx } = await locate({});
    expect(ctx.bindings.find((b) => b.capability === 'code-host')).toMatchObject({
      provider: 'bitbucket-cli',
    });
  });
});

describe('the manifest repository as a repository of the workspace', () => {
  const source = 'ssh://git@git.example.com:12345/fx/fx-workspace.git';
  const registry = (entry: Record<string, string>) =>
    new FakeConfigStore({
      default_workspace: 'fx',
      workspaces: { fx: { root: path.resolve('/ws/fx'), ...entry } },
    });
  const cloned = (): FakeFs => {
    const files = fs();
    files.mkdir(`${manifestDirFor('fx')}/.git`);
    return files;
  };

  it('appears last, checked out under ~/.fx, tracking the branch upstream points at', async () => {
    const git = new FakeGit().add(manifestDirFor('fx'), { remoteHeads: { upstream: 'trunk' } });
    const { ctx } = await locate({ config: registry({ source }), fs: cloned(), git });
    expect(ctx.workspace.repos.map((r) => r.name)).toEqual([
      'fx-example-api',
      'fx-example-auth',
      'fx-example-docs',
      'fx-workspace',
    ]);
    expect(ctx.workspace.repos[3]).toMatchObject({
      path: manifestDirFor('fx'),
      branch: 'trunk',
      project: 'fx',
      upstream: source,
      origin: 'manifest',
    });
  });

  it('is absent for a directory source, and yields to a manifest entry of the same name', async () => {
    const copied = await locate({ config: registry({ source: path.resolve('/src/manifest') }) });
    expect(copied.ctx.workspace.repos.map((r) => r.name)).toEqual([
      'fx-example-api',
      'fx-example-auth',
      'fx-example-docs',
    ]);
    const listed = await locate({
      config: registry({ source: 'ssh://git@git.example.com:12345/fx/fx-example-api.git' }),
      fs: cloned(),
    });
    expect(listed.ctx.workspace.repos.map((r) => r.name)).toEqual([
      'fx-example-api',
      'fx-example-auth',
      'fx-example-docs',
    ]);
    expect(listed.ctx.workspace.repos[0]?.origin).toBe('shared');
  });
});

describe('path aliases across the local layer', () => {
  it('refuses two entries that resolve to one checkout, however they are spelled', async () => {
    const { harness, ROOT } = await import('../../fakes/workspace.js');
    const path = await import('node:path');
    await expect(
      harness({
        local: {
          repos: [{ name: 'twin', path: path.join(ROOT, 'fx-example-api'), upstream: 'x' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_INVALID' });
    await expect(
      harness({ local: { repos: [{ name: 'twin', path: 'x/../fx-example-api', upstream: 'x' }] } }),
    ).rejects.toMatchObject({ code: 'LOCAL_INVALID' });
  });

  it('refuses native aliases that consume the root or overlap another checkout', async () => {
    const { harness, ROOT } = await import('../../fakes/workspace.js');
    await expect(
      harness({ local: { overrides: { 'fx-example-api': { path: ROOT } } } }),
    ).rejects.toMatchObject({ code: 'LOCAL_INVALID' });
    await expect(
      harness({
        local: { repos: [{ name: 'child', path: 'fx-example-api/child', upstream: 'x' }] },
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_INVALID' });
  });

  it('keeps a disjoint external checkout addressable by reference', async () => {
    const { harness } = await import('../../fakes/workspace.js');
    const h = await harness({
      local: {
        repos: [{ name: 'external', path: path.resolve('/elsewhere/external'), upstream: 'x' }],
      },
    });
    expect(h.ctx.workspace.repos.find((repo) => repo.name === 'external')?.path).toBe(
      path.resolve('/elsewhere/external'),
    );
  });
});
