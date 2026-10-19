import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { FileSource } from '../../../../src/adapters/manifest-source/file.js';
import { Init } from '../../../../src/application/init/index.js';
import { ResumeInit } from '../../../../src/application/init/resume.js';
import type { InitDeps, InitInput } from '../../../../src/application/init/types.js';
import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import type { SkillDeps } from '../../../../src/application/skill/targets.js';
import { ToolInstall } from '../../../../src/application/tool/install.js';
import type { WorkspaceDeps } from '../../../../src/application/workspace/deps.js';
import { providerCatalog } from '../../../../src/composition/registry.js';
import type { ManifestSource } from '../../../../src/ports/manifest-source.js';
import { bundledTools } from '../../../bundled-tools.js';
import { FakeActivity } from '../../../fakes/fake-activity.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { FakeCodeHost } from '../../../fakes/fake-code-host.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';
import { FakeFileProjection } from '../../../fakes/fake-file-projection.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeGit } from '../../../fakes/fake-git.js';
import { FakeInstaller } from '../../../fakes/fake-installer.js';
import { FakeLocalStore } from '../../../fakes/fake-local-store.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { fakeLoginDeps } from '../../../fakes/fake-login-deps.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';
import { fakeToolAudit } from '../../../fakes/fake-tool-history.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';

const manifest = readFileSync(
  path.resolve('test/fixtures/manifest/v1-minimal/workspace.yaml'),
  'utf8',
);
const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };
const ROOT = path.normalize(path.resolve('/ws/new'));
const manifestDirFor = (name: string): string =>
  path.normalize(`/fake/.fx/workspaces/${name}/source`);

class ScriptedSource implements ManifestSource {
  readonly kind = 'file';
  readonly description = path.resolve('/src/manifest');
  materialized: string[] = [];
  private hook: () => Promise<void> = async () => undefined;

  constructor(
    private readonly fs: FakeFs,
    private readonly workspace: string | null = manifest,
  ) {}

  // Runs once the manifest is in place, where a competing writer would have acted.
  afterMaterialize(hook: () => Promise<void>): this {
    this.hook = hook;
    return this;
  }

  async materialize(root: string): Promise<void> {
    this.materialized.push(root);
    if (this.workspace !== null)
      await this.fs.writeText(path.join(root, 'manifest', 'workspace.yaml'), this.workspace);
    await this.hook();
  }
}

// An applied, writable run into ROOT. A case names its source and what its decision turns on.
function initInput(fields: Pick<InitInput, 'source'> & Partial<InitInput>): InitInput {
  return { dir: ROOT, adopt: false, dryRun: false, posture: writable, jobs: 1, ...fields };
}

function skillDeps(hosts: SkillDeps['hosts'] = []): SkillDeps {
  return {
    hosts,
    configured: undefined,
    bundledSkillDir: path.resolve('/pkg/skills/fx-workspace'),
    globalLock: new FakeLock(),
  };
}

function setup(files: Record<string, string> = {}, configFile = {}) {
  const settled: string[] = [];
  const fs = FakeFs.from(files);
  const git = new FakeGit((dir) => fs.mkdir(dir));
  const config = new FakeConfigStore(configFile);
  const reporter = new FakeReporter();
  const codeHost = new FakeCodeHost();
  // The code host's own CLI is installed and current, so nothing blocks preparation.
  const process = new FakeProcess().always({ code: 0, stdout: '99.0.0', stderr: '' });
  process.binaries.add('bitbucket-cli');
  const deps: InitDeps = {
    fs,
    lock: new FakeLock(),
    git,
    config,
    localStore: new FakeLocalStore(),
    bundledTools,
    providers: providerCatalog(),
    cliVersion: '1.0.0',
    reporter,
    manifestDirFor,
    toolInstall: new ToolInstall({
      installers: FakeInstaller.family(['npm']),
      process,
      audit: fakeToolAudit(),
    }),
    stages: { login: fakeLoginDeps({}), skills: skillDeps() },
    settleManifest: async (name: string) => {
      settled.push(name);
    },
    workspaceDepsFor: (ctx): WorkspaceDeps => ({
      ctx,
      git,
      fs,
      projections: new FakeFileProjection(fs),
      localStore: new FakeLocalStore(),
      reporter,
      activity: new FakeActivity(),
      cliVersion: '1.0.0',
      user: undefined,
      process,
      trust: {
        gate: new TrustGate(new FakeTrustStore(), new FakePrompter()),
        workspace: ctx.name,
        yes: false,
        posture: writable,
      },
      codeHost: () => codeHost,
      platform: () => undefined,
      reference: () => ({ label: 'Reference', command: [] }),
    }),
  };
  const source = new ScriptedSource(fs);
  return { deps, fs, git, config, reporter, source, settled, process, codeHost };
}

describe('Init', () => {
  it.each([
    ['a preview', true],
    ['an applied run', false],
  ])(
    'rejects an invalid required tool before registering or cloning in %s',
    async (_run, dryRun) => {
      const s = setup({
        [path.resolve('/input/manifest/workspace.yaml')]: manifest,
        [path.resolve('/input/manifest/tools.yaml')]:
          'schema_version: 3\ntools: [{name: required-tool, required: true, binary: /unsafe/path, install: [{via: manual}]}]',
      });
      const source = new FileSource(path.resolve('/input'), s.fs);
      await expect(
        new Init(s.deps).execute(initInput({ source, name: 'new', dryRun })),
      ).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
      expect((await s.config.read()).workspaces).toBeUndefined();
      expect(s.git.calls).toEqual([]);
      expect(await s.fs.exists(manifestDirFor('new'))).toBe(false);
    },
  );
  it('previews the installation it then makes, for the opted-in tool alone', async () => {
    const s = setup({
      [path.resolve('/input/manifest/workspace.yaml')]: manifest,
      [path.resolve('/input/manifest/tools.yaml')]:
        "schema_version: 3\ntools: [{name: example-log, install_on_init: true, install: [{via: npm, spec: '@example/log'}]}, {name: example-other, install: [{via: npm, spec: '@example/other'}]}]",
    });
    const out = await new Init(s.deps).execute(
      initInput({ source: new FileSource(path.resolve('/input'), s.fs) }),
    );
    expect(out.prepared).toMatchObject({ tool_install: [{ name: 'example-log', ran: false }] });
    expect(out.tool_install).toMatchObject([{ name: 'example-log', ran: true, code: 0 }]);
    expect(s.process.vectors().filter((vector) => vector[0] === 'npm')).toEqual([
      ['npm', 'install', '-g', '@example/log@latest'],
    ]);
  });

  it('uses physical root identity both during planning and inside registration', async () => {
    const s = setup(
      {},
      { workspaces: { new: { root: ROOT, source: path.resolve('/src/manifest') } } },
    );
    const alias = path.resolve('/alias/new');
    s.fs.mkdir(ROOT);
    await s.fs.link(ROOT, alias);
    const out = await new Init(s.deps).execute(
      initInput({ dir: alias, name: 'new', source: s.source }),
    );
    expect(out.written).toBe(true);
    expect((await s.config.read()).workspaces?.new?.root).toBe(alias);
  });

  it('rechecks a competing registration inside the transaction', async () => {
    const s = setup();
    s.source.afterMaterialize(() =>
      s.config.write({
        user: 'preserved',
        workspaces: { new: { root: path.resolve('/other/new'), source: s.source.description } },
      }),
    );
    await expect(new Init(s.deps).execute(initInput({ source: s.source }))).rejects.toMatchObject({
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
      new Init(s.deps).execute(
        initInput({ source: new ScriptedSource(s.fs, 'schema_version: 999\nrepos: []') }),
      ),
    ).rejects.toMatchObject({
      partialResult: {
        registered: true,
        failed_phase: 'validation',
        preparation: {
          state: 'incomplete',
          resume: {
            argv: expect.arrayContaining([
              'init',
              ROOT,
              '--name',
              'new',
              '--from',
              path.resolve('/src/manifest'),
            ]),
          },
        },
      },
    });
    expect((await s.config.read()).workspaces?.new?.root).toBe(ROOT);
  });

  it('returns completed registration and repository evidence when a later stage fails', async () => {
    const s = setup();
    // Copying the bundled Skill to a selected host takes a lock that no preview takes.
    const skills: SkillDeps = {
      ...skillDeps([new FakeAgentHost('claude-code', true)]),
      globalLock: new FakeLock().onAcquire(() => {
        throw new Error('fixture failure');
      }),
    };
    const deps = { ...s.deps, stages: { ...s.deps.stages, skills } };
    await expect(new Init(deps).execute(initInput({ source: s.source }))).rejects.toMatchObject({
      partialResult: {
        registered: true,
        written: true,
        preparation: { state: 'incomplete' },
        next_steps: expect.arrayContaining([
          expect.stringContaining('fx init --resume --workspace new'),
        ]),
        failed_phase: 'sync',
        phases: { registration: 'done', tools: 'done', sync: 'failed' },
        sync: { stages: { docs: { created: 1 }, skills: { status: 'failed' } } },
      },
    });
  });

  it('reports registration without claiming readiness when repository synchronization fails', async () => {
    const { deps, source, git, config } = setup();
    git.before('clone', () => {
      throw new Error('fixture clone failed');
    });
    const result = await new Init(deps).execute(initInput({ source }));
    expect((await config.read()).workspaces?.new?.root).toBe(ROOT);
    expect(result.written).toBe(true);
    expect(result.preparation.state).toBe('incomplete');
    expect(result.sync!.summary.failed).toBeGreaterThan(0);
    expect(result.sync!.items.some((item) => item.failure?.next_steps.length)).toBe(true);
  });
  it('creates, registers as default, and syncs a brand-new directory', async () => {
    const { deps, git, config, source, settled } = setup();
    const out = await new Init(deps).execute(initInput({ source }));
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
    expect(out.sync?.stages).toMatchObject({ docs: { created: 1 } });
    expect(await config.read()).toEqual({
      default_workspace: 'new',
      workspaces: { new: { root: ROOT, source: path.resolve('/src/manifest') } },
    });
    expect(git.calls.filter((c) => c.startsWith('clone'))).toHaveLength(3);
    expect(out.sync?.summary.done).toBe(3);
    expect(out.preparation).toMatchObject({ state: 'ready', next_actions: [], blockers: [] });
  });

  it('uses an empty directory, keeps an existing default, and honours --name', async () => {
    const { deps, fs, config, source } = setup(
      {},
      { default_workspace: 'fx', workspaces: { fx: { root: path.resolve('/ws/fx') } } },
    );
    fs.mkdir(ROOT);
    const out = await new Init(deps).execute(initInput({ source, name: 'lab' }));
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
    const out = await new Init(file.deps).execute(initInput({ source: file.source }));
    expect(out).toMatchObject({ manifest: 'materialized', adopted: false, registered: true });
    expect(file.source.materialized).toEqual([manifestDirFor('new')]);

    const repo = setup(
      { ...files, [`${manifestDirFor('new')}/.git/HEAD`]: 'ref: refs/heads/main\n' },
      registered,
    );
    repo.git.add(manifestDirFor('new'), {
      state: { branch: 'main', dirty: false, untracked: 0, ahead: 0, behind: 0 },
    });
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
    const again = await new Init(repo.deps).execute(initInput({ source: repoSource }));
    expect(again).toMatchObject({ manifest: 'refreshed', registered: true });
    expect(refreshed).toEqual([manifestDirFor('new')]);
    expect(again.sync?.items.find((item) => item.action === 'skip_manifest')?.reason).toBe(
      'refreshed from upstream before the workspace loaded',
    );
    expect(repo.source.materialized).toEqual([]);
  });

  it('refuses a registered name whose recorded source differs, without touching anything', async () => {
    const { deps, source, config } = setup(
      {},
      {
        workspaces: { new: { root: ROOT, source: 'ssh://git@git.example.com:12345/fx/other.git' } },
      },
    );
    await expect(new Init(deps).execute(initInput({ source }))).rejects.toMatchObject({
      category: 'conflict',
      code: 'SOURCE_MISMATCH',
    });
    expect(source.materialized).toEqual([]);
    expect(config.writes).toBe(0);
  });

  it('adopts a hand-built directory without a blanket prompt and warns when the root is a repository', async () => {
    const stranger = setup({ [`${ROOT}/notes.txt`]: 'x' });
    const adopted = await new Init(stranger.deps).execute(initInput({ source: stranger.source }));
    expect(adopted).toMatchObject({ adopted: true, registered: true, written: true });
    expect(stranger.git.calls.filter((c) => c.startsWith('clone'))).toHaveLength(3);
    expect(stranger.reporter.codes()).not.toContain('ROOT_IS_GIT');

    const gitRoot = setup({ [`${ROOT}/notes.txt`]: 'x' });
    gitRoot.git.add(ROOT, { remotes: {} });
    const preview = await new Init(gitRoot.deps).execute(
      initInput({ source: gitRoot.source, adopt: true, dryRun: true }),
    );
    expect(preview).toMatchObject({ adopted: true, written: false });
    expect(gitRoot.reporter.codes()).toContain('ROOT_IS_GIT');
  });

  it('keeps an existing workspace and disambiguates an automatic name, while rejecting an explicit collision', async () => {
    const taken = setup({}, { workspaces: { new: { root: path.resolve('/elsewhere/new') } } });
    const input = initInput({ source: taken.source });
    await expect(
      new Init({ ...taken.deps, commandShell: 'cmd' }).execute({ ...input, name: 'new' }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_NAME_TAKEN',
      nextSteps: ['fx ^"workspace^" ^"show^" ^"new^"', expect.stringContaining('without --name')],
    });
    expect(taken.source.materialized).toEqual([]);
    const output = await new Init(taken.deps).execute(input);
    expect(output.name).toMatch(/^new-[a-f0-9]{8}$/);
    expect((await taken.config.read()).workspaces).toMatchObject({
      new: { root: path.resolve('/elsewhere/new') },
      [output.name]: { root: ROOT },
    });
  });

  it('describes the plan under dry-run and writes nothing', async () => {
    const { deps, config, source } = setup();
    const out = await new Init(deps).execute(initInput({ source, dryRun: true, posture: locked }));
    expect(out).toMatchObject({
      manifest: 'not_written',
      registered: false,
      sync: null,
      written: false,
    });
    expect(source.materialized).toEqual([]);
    expect(await config.read()).toEqual({});
  });

  it('refuses under read-only posture before touching anything', async () => {
    const { deps, source } = setup();
    await expect(
      new Init(deps).execute(initInput({ source, posture: locked })),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(source.materialized).toEqual([]);
  });

  it('leaves an invalid directory source unregistered', async () => {
    const s = setup();
    const source = new ScriptedSource(s.fs, 'schema_version: 1\nrepos: nope\n');
    await expect(new Init(s.deps).execute(initInput({ source }))).rejects.toMatchObject({
      code: 'MANIFEST_INVALID',
    });
    expect(await s.config.read()).toEqual({});
    expect(s.config.writes).toBe(0);
  });

  it('does not register a source with no workspace document', async () => {
    const s = setup();
    const source = new ScriptedSource(s.fs, null);
    await expect(new Init(s.deps).execute(initInput({ source }))).rejects.toMatchObject({
      code: 'MANIFEST_INVALID',
    });
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

    await expect(new Init(s.deps).execute(initInput({ source }))).rejects.toMatchObject({
      code: 'MANIFEST_INVALID',
    });
    expect(file.materialized).toEqual([manifestDirFor('new')]);
    expect(await s.config.read()).toEqual({});
    expect(s.config.writes).toBe(0);
  });
});

describe('initialization inspection', () => {
  it('plans from local content without commands, registration or personal writes', async () => {
    const s = setup({ [path.resolve('/preview/manifest/workspace.yaml')]: manifest });
    // FakeCodeHost records its readability probes; an identity query leaves no record there.
    const whoami = vi.spyOn(s.codeHost, 'whoami');
    const out = await new Init(s.deps).execute(
      initInput({
        source: new FileSource('/preview', s.fs),
        repos: ['fx-example-api'],
        dryRun: true,
        posture: locked,
      }),
    );
    expect(out.plan).toMatchObject({
      source_inspected: true,
      selection: { mode: 'explicit', validated: true },
      repositories: [
        { name: 'fx-example-api', action: 'clone' },
        { name: 'fx-example-auth', action: 'skip_unpicked' },
        { name: 'fx-example-docs', action: 'skip_unpicked' },
      ],
    });
    expect(whoami).not.toHaveBeenCalled();
    expect(s.codeHost.probes).toEqual([]);
    expect(s.fs.writes).toEqual([]);
    expect(s.config.writes).toBe(0);
    expect(await s.deps.localStore.read('new')).toEqual({});
  });
});

describe('resuming a registered workspace', () => {
  const recorded = path.resolve('/src/manifest');
  const managed = `${manifestDirFor('new')}/manifest/workspace.yaml`;
  const run = { dryRun: false, posture: writable, jobs: 1 };

  function registered(entry: { root: string; source?: string }, kept = manifest) {
    const s = setup({ [managed]: kept }, { workspaces: { new: entry } });
    const usecase = new ResumeInit({
      ...s.deps,
      inspectManaged: (dir) => new FileSource(dir, s.fs).inspect(),
    });
    return { ...s, usecase };
  }

  it('prepares from the managed directory and imports nothing into it', async () => {
    const s = registered({ root: ROOT, source: recorded });
    const out = await s.usecase.execute({ ...run, workspace: 'new', cwd: ROOT });
    expect(out).toMatchObject({
      name: 'new',
      root: ROOT,
      source: recorded,
      manifest: 'kept',
      written: true,
      plan: { manifest_action: 'keep', inspected_source: manifestDirFor('new') },
      preparation: { state: 'ready' },
    });
    expect(s.fs.writes.filter((file) => file.startsWith(manifestDirFor('new')))).toEqual([]);
    expect(s.settled).toEqual([]);
    expect((await s.config.read()).workspaces).toEqual({ new: { root: ROOT, source: recorded } });
  });

  it('leaves a registration that records no source without one', async () => {
    const s = registered({ root: ROOT });
    await s.usecase.execute({ ...run, workspace: 'new', cwd: ROOT });
    expect((await s.config.read()).workspaces).toEqual({ new: { root: ROOT } });
  });

  it('finds the registration by its root, read against the caller directory', async () => {
    const s = registered({ root: ROOT, source: recorded });
    const out = await s.usecase.execute({ ...run, dryRun: true, workspace: '.', cwd: ROOT });
    expect(out).toMatchObject({ name: 'new', root: ROOT, manifest: 'not_written' });
  });

  it('keeps the personal repository selection', async () => {
    const s = registered({ root: ROOT, source: recorded });
    await s.deps.localStore.write('new', { scope: { repos: ['fx-example-auth'] } });
    const out = await s.usecase.execute({ ...run, workspace: 'new', cwd: ROOT });
    expect(out.plan.selection).toEqual({
      mode: 'explicit',
      repos: ['fx-example-auth'],
      validated: true,
    });
    expect(await s.deps.localStore.read('new')).toEqual({ scope: { repos: ['fx-example-auth'] } });
  });

  it('refuses a workspace that is not registered', async () => {
    const s = registered({ root: ROOT, source: recorded });
    await expect(
      s.usecase.execute({ ...run, workspace: 'absent', cwd: ROOT }),
    ).rejects.toMatchObject({ category: 'not_found', code: 'WORKSPACE_UNKNOWN' });
    expect(s.config.writes).toBe(0);
  });

  it('quotes the command that shows a registered workspace for the configured shell', async () => {
    const s = registered({ root: ROOT, source: recorded });
    const usecase = new ResumeInit({
      ...s.deps,
      commandShell: 'cmd',
      inspectManaged: async () => undefined,
    });
    await expect(usecase.execute({ ...run, workspace: 'absent', cwd: ROOT })).rejects.toMatchObject(
      {
        code: 'WORKSPACE_UNKNOWN',
        nextSteps: ['fx workspace list', 'fx ^"workspace^" ^"show^" ^"new^"'],
      },
    );
  });

  it('names the recorded source and the resume command when the kept manifest is invalid', async () => {
    const s = registered({ root: ROOT, source: recorded }, 'schema_version: 999\nrepos: []');
    await expect(
      s.usecase.execute({ ...run, dryRun: true, workspace: 'new', cwd: ROOT }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(`Candidate source: ${recorded}`),
      nextSteps: ['fx init --resume --workspace new --dry-run'],
    });
  });
});
