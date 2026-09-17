// Materialize, validate and register a workspace before synchronizing its resources.

import path from 'node:path';

import { asDevkitError, DevkitError, toEnvelope, withPartialResult } from '../domain/errors.js';
import { samePath, windowsPathProblem } from '../domain/path.js';
import { changeDirectoryCommand, shellLine, type ResolvedShell } from '../domain/shell.js';
import { assertWorkspaceName, assertWorkspaceNames } from '../domain/workspace/name.js';
import type { FileSystem } from '../ports/fs.js';
import type { Git } from '../ports/git.js';
import type { Lock } from '../ports/lock.js';
import type { ManifestSource } from '../ports/manifest-source.js';
import type { Reporter } from '../ports/reporter.js';
import type { ConfigFile, ConfigStore, LocalLayerStore, WorkspaceEntry } from '../ports/stores.js';

import { LoadManifest } from './manifest/load.js';
import { RefreshManifest } from './refresh-manifest.js';
import { assertWritable, type WritePosture } from './safety/posture.js';
import { Sync, type SyncOutput, type SyncStages } from './sync.js';
import type { ToolInstallOutput } from './tool/install.js';
import type { WorkspaceDeps } from './workspace/deps.js';
import { assertNoWorkspaceOperation } from './workspace/health.js';
import { withWorkspaceOperation } from './workspace/operation.js';
import { assertDistinctWorkspaceRoot } from './workspace/registry.js';
import { WorkspaceContext } from './workspace-context.js';

export interface InitDeps {
  readonly lock: Lock;
  readonly commandShell?: ResolvedShell | undefined;
  readonly fs: FileSystem;
  readonly git: Git;
  readonly config: ConfigStore;
  readonly localStore: LocalLayerStore;
  readonly bundledTools: () => string;
  readonly cliVersion: string;
  readonly reporter: Reporter;
  readonly manifestDirFor: (name: string) => string;
  readonly workspaceDepsFor: (ctx: WorkspaceContext) => WorkspaceDeps;
  readonly preview?: (ctx: WorkspaceContext) => Promise<object>;
  readonly installTools?: (ctx: WorkspaceContext) => Promise<readonly ToolInstallOutput[]>;
  readonly stagesFor: (ctx: WorkspaceContext) => SyncStages;
  readonly settleManifest: (name: string, manifestDir: string) => Promise<void>;
}

export interface InitInput {
  readonly dir: string;
  readonly source: ManifestSource;
  readonly name?: string | undefined;
  readonly adopt: boolean;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly jobs: number;
}

export interface InitOutput {
  readonly operation: 'preview' | 'apply';
  readonly preparation_complete: boolean | null;
  readonly root: string;
  readonly name: string;
  readonly source: string;
  readonly manifest_dir: string;
  readonly manifest: 'materialized' | 'refreshed';
  readonly adopted: boolean;
  readonly registered: boolean;
  readonly default_workspace: boolean;
  readonly sync: SyncOutput | null;
  readonly tool_install: readonly ToolInstallOutput[] | null;
  readonly next_steps: readonly string[];
  readonly written: boolean;
}

type DirState = 'new' | 'empty' | 'registered' | 'adopted';

interface Plan {
  readonly output: InitOutput;
  readonly config: ConfigFile;
}

export class Init {
  constructor(private readonly deps: InitDeps) {}

  async execute(input: InitInput): Promise<InitOutput> {
    const name = input.name ?? path.basename(path.resolve(input.dir));
    assertWorkspaceName(name);
    return withWorkspaceOperation(this.deps.lock, name, input.dryRun, async () => {
      const plan = await this.plan(input);
      if (input.dryRun) return plan.output;
      assertWritable(input.posture, `init ${plan.output.root}`);
      return this.apply(plan, input);
    });
  }

  private async plan(input: InitInput): Promise<Plan> {
    const root = path.resolve(input.dir);
    const problem = path.sep === '\\' ? windowsPathProblem(root) : undefined;
    if (problem) throw new DevkitError('usage', 'WORKSPACE_PATH_INVALID', problem);
    const name = input.name ?? path.basename(root);
    assertWorkspaceName(name);
    const config = await this.deps.config.read();
    assertWorkspaceNames([...new Set([...Object.keys(config.workspaces ?? {}), name])]);
    await assertNoWorkspaceOperation(this.deps, {
      name,
      manifestDir: this.deps.manifestDirFor(name),
    });
    await assertDistinctWorkspaceRoot(config, name, root, this.deps.fs);
    const existing = config.workspaces?.[name];
    if (existing !== undefined && !(await this.sameRoot(existing.root, root)))
      throw nameTaken(name, root, existing, input.source);
    if (existing?.source !== undefined && existing.source !== input.source.description)
      throw sourceMismatch(name, existing.source, input.source);
    const state = await this.dirState(root, existing !== undefined);
    if (state === 'adopted') await this.warnIfRepository(root);
    const manifestDir = this.deps.manifestDirFor(name);
    const refreshed =
      existing !== undefined &&
      input.source.refresh !== undefined &&
      (await this.deps.fs.exists(manifestDir));
    return {
      config,
      output: {
        operation: input.dryRun ? 'preview' : 'apply',
        preparation_complete: null,
        root,
        name,
        source: input.source.description,
        manifest_dir: manifestDir,
        manifest: refreshed ? 'refreshed' : 'materialized',
        adopted: state === 'adopted',
        registered: existing === undefined,
        default_workspace: config.default_workspace === undefined,
        sync: null,
        tool_install: null,
        next_steps: [],
        written: false,
      },
    };
  }

  private async apply(plan: Plan, input: InitInput): Promise<InitOutput> {
    const { output } = plan;
    let phase = 'manifest';
    let registered = plan.config.workspaces?.[output.name] !== undefined;
    let materialized = false;
    let prepared: object | null = null;
    let toolInstall: readonly ToolInstallOutput[] | null = null;
    try {
      await this.materialize(output, input);
      materialized = true;
      phase = 'validation';
      await new LoadManifest(this.deps.fs, this.deps.bundledTools).execute({
        dir: output.manifest_dir,
        cliVersion: this.deps.cliVersion,
      });
      if (output.manifest === 'materialized')
        await this.deps.settleManifest(output.name, output.manifest_dir);
      phase = 'registration';
      await this.register(output, input);
      registered = true;
      phase = 'tools';
      const ctx = await this.context(output);
      prepared = (await this.deps.preview?.(ctx)) ?? null;
      if (prepared !== null)
        this.deps.reporter.notice({
          code: 'INIT_PREPARED',
          message:
            'Initialization effects planned before tool execution and repository cloning; inspect the plan and exact command trust prompts.',
          data: { plan: prepared },
        });
      toolInstall = (await this.deps.installTools?.(ctx)) ?? [];
      phase = 'sync';
      const sync = await new Sync(this.deps.workspaceDepsFor(ctx)).execute({
        dryRun: false,
        posture: input.posture,
        jobs: input.jobs,
        stages: this.deps.stagesFor(ctx),
      });
      const done = {
        ...output,
        preparation_complete: sync.preparation_complete,
        sync,
        tool_install: toolInstall,
        prepared,
        next_steps: nextSteps(output.root, sync, this.deps.commandShell),
        written: true,
      };
      this.deps.reporter.notice({
        code: 'INIT_DONE',
        message: `workspace ${done.name} is registered at ${done.root}; inspect synchronization results and doctor readiness`,
        nextSteps: done.next_steps,
      });
      return done;
    } catch (error) {
      throw initFailure(output, error, { phase, registered, materialized, prepared, toolInstall });
    }
  }

  private async materialize(output: InitOutput, input: InitInput): Promise<void> {
    if (output.manifest === 'refreshed') {
      await new RefreshManifest(this.deps.reporter).execute({
        manifestDir: output.manifest_dir,
        source: input.source,
        dryRun: false,
        posture: input.posture,
        settle: () => this.deps.settleManifest(output.name, output.manifest_dir),
      });
    } else {
      await input.source.materialize(output.manifest_dir);
    }
  }

  private async register(output: InitOutput, input: InitInput): Promise<void> {
    await this.deps.config.update(async (current) => {
      await assertDistinctWorkspaceRoot(current, output.name, output.root, this.deps.fs);
      const existing = current.workspaces?.[output.name];
      if (existing && !(await this.sameRoot(existing.root, output.root)))
        throw nameTaken(output.name, output.root, existing, input.source);
      if (existing?.source !== undefined && existing.source !== output.source)
        throw sourceMismatch(output.name, existing.source, input.source);
      return {
        ...current,
        default_workspace: current.default_workspace ?? output.name,
        workspaces: {
          ...current.workspaces,
          [output.name]: { root: output.root, source: output.source },
        },
      };
    });
  }

  private async sameRoot(left: string, right: string): Promise<boolean> {
    return samePath(await this.deps.fs.realpath(left), await this.deps.fs.realpath(right));
  }

  private context(output: InitOutput): Promise<WorkspaceContext> {
    return WorkspaceContext.locate({
      cwd: output.root,
      allowMissingRoot: true,
      name: output.name,
      config: this.deps.config,
      fs: this.deps.fs,
      git: this.deps.git,
      localStore: this.deps.localStore,
      bundledTools: this.deps.bundledTools,
      cliVersion: this.deps.cliVersion,
      reporter: this.deps.reporter,
      manifestDirFor: this.deps.manifestDirFor,
    });
  }

  private async dirState(root: string, registered: boolean): Promise<DirState> {
    if (!(await this.deps.fs.exists(root))) return 'new';
    if (registered) return 'registered';
    if ((await this.deps.fs.readDir(root)).length === 0) return 'empty';
    return 'adopted';
  }

  private async warnIfRepository(root: string): Promise<void> {
    const top = await this.deps.git.toplevel(root);
    if (top === undefined) return;
    if ((await this.deps.fs.realpath(top)) !== (await this.deps.fs.realpath(root))) return;
    this.deps.reporter.notice({
      code: 'ROOT_IS_GIT',
      message: `${root} is itself a git repository; the workspace root should be a plain directory`,
      nextSteps: [`mv ${root}/.git ${root}/.git.aside`, 'fx doctor'],
    });
  }
}

function nameTaken(
  name: string,
  root: string,
  existing: WorkspaceEntry,
  source: ManifestSource,
): DevkitError {
  return new DevkitError(
    'conflict',
    'WORKSPACE_NAME_TAKEN',
    `workspace "${name}" is already registered at ${existing.root}`,
    {
      hint: 'If the directory moved, relocate its existing identity; otherwise initialize the registered directory.',
      nextSteps: [
        shellLine(['fx', 'workspace', 'relocate', name, root]),
        shellLine(['fx', 'init', existing.root, '--name', name, '--from', source.description]),
      ],
    },
  );
}

function sourceMismatch(name: string, recorded: string, source: ManifestSource): DevkitError {
  return new DevkitError(
    'conflict',
    'SOURCE_MISMATCH',
    `workspace "${name}" takes its manifest from ${recorded}, not ${source.description}`,
    {
      hint: 'Use workspace rebind to replace the source while preserving identity and local scope.',
      nextSteps: [
        shellLine(['fx', 'workspace', 'rebind', name, '--from', source.description]),
        shellLine(['fx', 'workspace', 'show', name]),
      ],
    },
  );
}

function nextSteps(root: string, sync: SyncOutput, shell?: ResolvedShell): string[] {
  const steps = [changeDirectoryCommand(root, shell), 'fx login --list', 'fx doctor'];
  for (const item of sync.items.filter((i) => i.action === 'unreadable')) {
    steps.push(
      `${item.name}: ${item.reason ?? 'unreadable'}${item.contact === undefined ? '' : `; ask ${item.contact}`}`,
    );
  }
  return steps;
}

interface InitProgress {
  readonly phase: string;
  readonly registered: boolean;
  readonly materialized: boolean;
  readonly prepared: object | null;
  readonly toolInstall: readonly ToolInstallOutput[] | null;
}

function initFailure(output: InitOutput, error: unknown, progress: InitProgress): DevkitError {
  const failure = asDevkitError(error);
  const { phase, registered, materialized, prepared, toolInstall } = progress;
  const names = ['manifest', 'validation', 'registration', 'tools', 'sync'];
  const failedAt = names.indexOf(phase);
  const phases = Object.fromEntries(
    names.map((name, index) => {
      if (index < failedAt) return [name, 'done'];
      return [name, index === failedAt ? 'failed' : 'not_started'];
    }),
  );
  const install = failure.partialResult as
    { tool_install?: readonly ToolInstallOutput[] } | undefined;
  return withPartialResult(failure, {
    ...output,
    preparation_complete: false,
    registered,
    written: materialized,
    prepared,
    tool_install: toolInstall ?? install?.tool_install ?? null,
    sync: phase === 'sync' ? (failure.partialResult ?? null) : null,
    phases,
    failed_phase: phase,
    failure: toEnvelope(failure).error,
    next_steps: registered
      ? [
          ...failure.nextSteps,
          `Inspect remaining stages with fx status --workspace ${output.name} --format json.`,
        ]
      : [
          'Correct the reported source problem and retry the same init command.',
          ...failure.nextSteps,
        ],
  });
}
