import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { Init, type InitDeps } from '../../../src/application/init.js';
import type { WritePosture } from '../../../src/application/safety/posture.js';
import type { WorkspaceDeps } from '../../../src/application/workspace/deps.js';
import type { ManifestSource } from '../../../src/ports/manifest-source.js';
import { FakeCache } from '../../fakes/fake-cache.js';
import { FakeCodeHost } from '../../fakes/fake-code-host.js';
import { FakeConfigStore } from '../../fakes/fake-config-store.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeGit } from '../../fakes/fake-git.js';
import { FakeLocalStore } from '../../fakes/fake-local-store.js';
import { FakeReporter } from '../../fakes/fake-reporter.js';

const manifest = readFileSync(
  path.resolve('test/fixtures/manifest/v1-minimal/workspace.yaml'),
  'utf8',
);
const bundled = (): string => readFileSync(path.resolve('defaults/tools.yaml'), 'utf8');
const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };
const ROOT = path.normalize(path.resolve('/ws/new'));
const manifestDirFor = (name: string): string =>
  path.normalize(`/fake/.fx/workspaces/${name}/source`);

class ScriptedSource implements ManifestSource {
  readonly kind = 'file';
  readonly description = path.resolve('/src/manifest');
  materialized: string[] = [];

  constructor(
    private readonly fs: FakeFs,
    private readonly workspace: string | null = manifest,
  ) {}

  async materialize(root: string): Promise<void> {
    this.materialized.push(root);
    if (this.workspace !== null)
      await this.fs.writeText(path.join(root, 'manifest', 'workspace.yaml'), this.workspace);
  }
}

function setup(files: Record<string, string> = {}, configFile = {}) {
  const fs = FakeFs.from(files);
  const git = new FakeGit((dir) => fs.mkdir(dir));
  const config = new FakeConfigStore(configFile);
  const reporter = new FakeReporter();
  const codeHost = new FakeCodeHost();
  const deps: InitDeps = {
    fs,
    git,
    config,
    localStore: new FakeLocalStore(),
    bundledTools: bundled,
    cliVersion: '1.0.0',
    reporter,
    manifestDirFor,
    stagesFor: () => ({ docs: async () => ({ summary: { created: 2 } }) }),
    settleManifest: async (name: string) => {
      settled.push(name);
    },
    workspaceDepsFor: (ctx): WorkspaceDeps => ({
      ctx,
      git,
      fs,
      localStore: new FakeLocalStore(),
      cache: new FakeCache(),
      reporter,
      cliVersion: '1.0.0',
      user: undefined,
      processRun: async () => ({ code: 0, stdout: '', stderr: '' }),
      processWhich: async () => undefined,
      codeHost: () => codeHost,
      platform: () => undefined,
      reference: () => ({ label: 'Reference', command: [] }),
    }),
  };
  const source = new ScriptedSource(fs);
  return { deps, fs, git, config, reporter, source };
}

const settled: string[] = [];

describe('Init', () => {
  it('uses physical root identity both during planning and inside registration', async () => {
    const s = setup(
      {},
      { workspaces: { new: { root: ROOT, source: path.resolve('/src/manifest') } } },
    );
    const alias = path.resolve('/alias/new');
    vi.spyOn(s.fs, 'realpath').mockImplementation(async (value) =>
      value === alias ? ROOT : value,
    );
    const out = await new Init(s.deps).execute({
      dir: alias,
      name: 'new',
      source: s.source,
      adopt: false,
      dryRun: false,
      posture: writable,
      jobs: 2,
    });
    expect(out.written).toBe(true);
    expect((await s.config.read()).workspaces?.new?.root).toBe(alias);
  });

  it('rechecks a competing registration inside the transaction', async () => {
    const s = setup();
    const original = s.source.materialize.bind(s.source);
    s.source.materialize = async (dir) => {
      await original(dir);
      await s.config.write({
        user: 'preserved',
        workspaces: { new: { root: path.resolve('/other/new'), source: s.source.description } },
      });
    };
    await expect(
      new Init(s.deps).execute({
        dir: ROOT,
        source: s.source,
        adopt: false,
        dryRun: false,
        posture: writable,
        jobs: 2,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_NAME_TAKEN',
      partialResult: { failed_phase: 'registration' },
    });
    expect((await s.config.read()).user).toBe('preserved');
    expect((await s.config.read()).workspaces?.new?.root).toBe(path.resolve('/other/new'));
  });

  it('retains an existing registration when source validation fails on re-entry', async () => {
    const s = setup(
      {},
      { workspaces: { new: { root: ROOT, source: path.resolve('/src/manifest') } } },
    );
    await expect(
      new Init(s.deps).execute({
        dir: ROOT,
        source: new ScriptedSource(s.fs, 'schema_version: 999\nrepos: []'),
        adopt: false,
        dryRun: false,
        posture: writable,
        jobs: 2,
      }),
    ).rejects.toMatchObject({
      partialResult: {
        registered: true,
        failed_phase: 'validation',
        preparation_complete: false,
        next_steps: expect.arrayContaining([expect.stringContaining('fx status --workspace new')]),
      },
    });
    expect((await s.config.read()).workspaces?.new?.root).toBe(ROOT);
  });

  it('returns completed registration and repository evidence when a later stage fails', async () => {
    const s = setup();
    const deps = {
      ...s.deps,
      stagesFor: () => ({
        docs: async () => ({ summary: { created: 2 } }),
        skills: async () => {
          throw new Error('fixture failure');
        },
      }),
    };
    await expect(
      new Init(deps).execute({
        dir: ROOT,
        source: s.source,
        adopt: false,
        dryRun: false,
        posture: writable,
        jobs: 2,
      }),
    ).rejects.toMatchObject({
      partialResult: {
        registered: true,
        written: true,
        preparation_complete: false,
        next_steps: expect.arrayContaining([expect.stringContaining('fx status --workspace new')]),
        failed_phase: 'sync',
        phases: { registration: 'done', tools: 'done', sync: 'failed' },
        sync: { stages: { docs: { created: 2 }, skills: { status: 'failed' } } },
      },
    });
  });

  it('reports registration without claiming readiness when repository synchronization fails', async () => {
    const { deps, source, git, reporter, config } = setup();
    vi.spyOn(git, 'clone').mockRejectedValue(new Error('fixture clone failed'));
    const result = await new Init(deps).execute({
      dir: ROOT,
      source,
      adopt: false,
      dryRun: false,
      posture: writable,
      jobs: 2,
    });
    expect((await config.read()).workspaces?.new?.root).toBe(ROOT);
    expect(result.written).toBe(true);
    expect(result.sync!.summary.failed).toBeGreaterThan(0);
    expect(result.sync!.items.some((item) => item.failure?.next_steps.length)).toBe(true);
    const notice = reporter.notices.find((notice) => notice.code === 'INIT_DONE');
    expect(notice?.message).toContain('registered');
    expect(notice?.message).not.toMatch(/\bis ready\b/);
  });
  it('creates, registers as default, and syncs a brand-new directory', async () => {
    settled.length = 0;
    const { deps, git, config, source } = setup();
    const out = await new Init(deps).execute({
      dir: ROOT,
      source,
      adopt: false,
      dryRun: false,
      posture: writable,
      jobs: 2,
    });
    expect(settled).toEqual(['new']);
    expect(out).toMatchObject({
      root: ROOT,
      name: 'new',
      manifest: 'materialized',
      manifest_dir: manifestDirFor('new'),
      adopted: false,
      registered: true,
      default_workspace: true,
      written: true,
    });
    expect(source.materialized).toEqual([manifestDirFor('new')]);
    expect(out.sync?.stages).toEqual({
      docs: { created: 2 },
    });
    expect(await config.read()).toEqual({
      default_workspace: 'new',
      workspaces: { new: { root: ROOT, source: path.resolve('/src/manifest') } },
    });
    expect(git.calls.filter((c) => c.startsWith('clone'))).toHaveLength(3);
    expect(out.sync?.summary.done).toBe(3);
    expect(out.next_steps).toEqual([`cd ${ROOT}`, 'fx login --list', 'fx doctor']);
  });

  it('uses an empty directory, keeps an existing default, and honours --name', async () => {
    const { deps, fs, config, source } = setup(
      {},
      { default_workspace: 'fx', workspaces: { fx: { root: path.resolve('/ws/fx') } } },
    );
    fs.mkdir(ROOT);
    const out = await new Init(deps).execute({
      dir: ROOT,
      source,
      name: 'lab',
      adopt: false,
      dryRun: false,
      posture: writable,
      jobs: 1,
    });
    expect(out).toMatchObject({ name: 'lab', default_workspace: false, registered: true });
    expect((await config.read()).workspaces?.['lab']?.root).toBe(ROOT);
    expect((await config.read()).default_workspace).toBe('fx');
  });

  it('re-runs on a registered root: a repository source is refreshed, a directory source rewritten', async () => {
    const registered = {
      workspaces: { new: { root: ROOT, source: path.resolve('/src/manifest') } },
    };
    const files = {
      [`${manifestDirFor('new')}/manifest/workspace.yaml`]: manifest,
      [`${ROOT}/a/.git`]: '',
    };
    const file = setup(files, registered);
    const out = await new Init(file.deps).execute({
      dir: ROOT,
      source: file.source,
      adopt: false,
      dryRun: false,
      posture: writable,
      jobs: 1,
    });
    expect(out).toMatchObject({ manifest: 'materialized', adopted: false, registered: false });
    expect(file.source.materialized).toEqual([manifestDirFor('new')]);

    const repo = setup(files, registered);
    const refreshed: string[] = [];
    const repoSource: ManifestSource = {
      ...repo.source,
      kind: 'repo',
      materialize: (dir) => repo.source.materialize(dir),
      refresh: async (dir) => {
        refreshed.push(dir);
        return { result: 'updated' as const };
      },
    };
    const again = await new Init(repo.deps).execute({
      dir: ROOT,
      source: repoSource,
      adopt: false,
      dryRun: false,
      posture: writable,
      jobs: 1,
    });
    expect(again).toMatchObject({ manifest: 'refreshed', registered: false });
    expect(refreshed).toEqual([manifestDirFor('new')]);
    expect(repo.source.materialized).toEqual([]);
  });

  it('refuses a registered name whose recorded source differs, without touching anything', async () => {
    const { deps, source, config } = setup(
      {},
      {
        workspaces: { new: { root: ROOT, source: 'ssh://git@git.example.com:12345/fx/other.git' } },
      },
    );
    await expect(
      new Init(deps).execute({
        dir: ROOT,
        source,
        adopt: false,
        dryRun: false,
        posture: writable,
        jobs: 1,
      }),
    ).rejects.toMatchObject({ category: 'conflict', code: 'SOURCE_MISMATCH' });
    expect(source.materialized).toEqual([]);
    expect(config.writes).toBe(0);
  });

  it('adopts a hand-built directory without a blanket prompt and warns when the root is a repository', async () => {
    const stranger = setup({ [`${ROOT}/notes.txt`]: 'x' });
    const adopted = await new Init(stranger.deps).execute({
      dir: ROOT,
      source: stranger.source,
      adopt: false,
      dryRun: false,
      posture: writable,
      jobs: 1,
    });
    expect(adopted).toMatchObject({ adopted: true, registered: true, written: true });
    expect(stranger.git.calls.filter((c) => c.startsWith('clone'))).toHaveLength(3);
    expect(stranger.reporter.codes()).not.toContain('ROOT_IS_GIT');

    const gitRoot = setup({ [`${ROOT}/notes.txt`]: 'x' });
    gitRoot.git.add(ROOT, { remotes: {} });
    const preview = await new Init(gitRoot.deps).execute({
      dir: ROOT,
      source: gitRoot.source,
      adopt: true,
      dryRun: true,
      posture: writable,
      jobs: 1,
    });
    expect(preview).toMatchObject({ adopted: true, written: false });
    expect(gitRoot.reporter.codes()).toContain('ROOT_IS_GIT');
  });

  it('refuses a taken name', async () => {
    const taken = setup({}, { workspaces: { new: { root: path.resolve('/elsewhere/new') } } });
    await expect(
      new Init(taken.deps).execute({
        dir: ROOT,
        source: taken.source,
        adopt: false,
        dryRun: false,
        posture: writable,
        jobs: 1,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NAME_TAKEN' });
  });

  it('describes the plan under dry-run and writes nothing', async () => {
    const { deps, config, source } = setup();
    const out = await new Init(deps).execute({
      dir: ROOT,
      source,
      adopt: false,
      dryRun: true,
      posture: locked,
      jobs: 1,
    });
    expect(out).toMatchObject({
      manifest: 'materialized',
      registered: true,
      sync: null,
      written: false,
    });
    expect(source.materialized).toEqual([]);
    expect(await config.read()).toEqual({});
  });

  it('refuses under read-only posture before touching anything', async () => {
    const { deps, source } = setup();
    await expect(
      new Init(deps).execute({
        dir: ROOT,
        source,
        adopt: false,
        dryRun: false,
        posture: locked,
        jobs: 1,
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(source.materialized).toEqual([]);
  });

  it('leaves an invalid directory source unregistered', async () => {
    const s = setup();
    const source = new ScriptedSource(s.fs, 'schema_version: 1\nrepos: nope\n');
    await expect(
      new Init(s.deps).execute({
        dir: ROOT,
        source,
        adopt: false,
        dryRun: false,
        posture: writable,
        jobs: 1,
      }),
    ).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
    expect(await s.config.read()).toEqual({});
    expect(s.config.writes).toBe(0);
  });

  it('does not register a source with no workspace document', async () => {
    const s = setup();
    const source = new ScriptedSource(s.fs, null);
    await expect(
      new Init(s.deps).execute({
        dir: ROOT,
        source,
        adopt: false,
        dryRun: false,
        posture: writable,
        jobs: 1,
      }),
    ).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
    expect(await s.config.read()).toEqual({});
    expect(s.config.writes).toBe(0);
  });

  it('keeps a successful repository clone unregistered when its manifest cannot load', async () => {
    const s = setup();
    const file = new ScriptedSource(s.fs, 'schema_version: 1\nrepos: nope\n');
    const source: ManifestSource = {
      kind: 'repo',
      description: 'ssh://git@git.example.com/fx/workspace.git',
      materialize: (dir) => file.materialize(dir),
    };

    await expect(
      new Init(s.deps).execute({
        dir: ROOT,
        source,
        adopt: false,
        dryRun: false,
        posture: writable,
        jobs: 1,
      }),
    ).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
    expect(file.materialized).toEqual([manifestDirFor('new')]);
    expect(await s.config.read()).toEqual({});
    expect(s.config.writes).toBe(0);
  });
});
