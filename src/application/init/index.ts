// Materialize, validate and register a workspace before synchronizing its resources.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { samePath, windowsPathProblem } from '../../domain/path.js';
import { changeDirectoryCommand, type ResolvedShell } from '../../domain/shell.js';
import { assertWorkspaceName, assertWorkspaceNames } from '../../domain/workspace/name.js';
import type { ConfigFile } from '../../ports/stores.js';
import { LoadManifest, type ManifestBundle } from '../manifest/load.js';
import { RefreshManifest } from '../refresh-manifest.js';
import { assertWritable } from '../safety/posture.js';
import { Sync, type SyncOutput } from '../sync.js';
import type { ToolInstallOutput } from '../tool/install.js';
import { assertNoWorkspaceOperation } from '../workspace/health.js';
import { withWorkspaceOperation } from '../workspace/operation.js';
import { assertDistinctWorkspaceRoot } from '../workspace/registry.js';
import { scopeMode } from '../workspace/scope.js';
import { WorkspaceContext } from '../workspace-context.js';

import { initFailure, initializationSourceError, nameTaken, sourceMismatch } from './errors.js';
import { initialLocalLayer, inspectInitialization, initialPlan } from './preview.js';
import type { InitDeps, InitInput, InitOutput } from './types.js';

type DirState = 'new' | 'empty' | 'registered' | 'adopted';

interface Plan {
  readonly output: InitOutput;
  readonly config: ConfigFile;
}

export class Init {
  constructor(private readonly deps: InitDeps) {}

  async execute(input: InitInput): Promise<InitOutput> {
    const preview = await this.plan(input);
    if (input.dryRun) {
      const inspection = await input.source
        .inspect?.(
          preview.output.plan.manifest_action === 'refresh'
            ? preview.output.manifest_dir
            : undefined,
        )
        .catch((error: unknown) => {
          throw initializationSourceError(this.deps, input, preview.output, undefined, error);
        });
      return {
        ...preview.output,
        plan: await inspectInitialization(this.deps, input, preview.output, inspection),
      };
    }
    assertWritable(input.posture, `init ${preview.output.root}`);
    return withWorkspaceOperation(this.deps.lock, preview.output.name, false, async () => {
      const plan = await this.plan(input);
      return this.apply(plan, input);
    });
  }

  private async plan(input: InitInput): Promise<Plan> {
    const root = path.resolve(input.dir);
    const problem = path.sep === '\\' ? windowsPathProblem(root) : undefined;
    if (problem)
      throw new DevkitError('usage', 'WORKSPACE_PATH_INVALID', problem, {
        nextSteps: [`Choose a local workspace directory Windows can address instead of ${root}.`],
      });
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
    const local = await this.deps.localStore.read(name);
    const manifest = refreshed ? 'refreshed' : 'materialized';
    return {
      config,
      output: {
        operation: input.dryRun ? 'preview' : 'apply',
        preparation_complete: null,
        root,
        name,
        source: input.source.description,
        manifest_dir: manifestDir,
        manifest: input.dryRun ? 'not_written' : manifest,
        adopted: state === 'adopted',
        registered: existing !== undefined,
        default_workspace: config.default_workspace === name,
        sync: null,
        tool_install: null,
        next_steps: [],
        written: false,
        plan: initialPlan(this.deps, input, { name, root, manifestDir, refreshed, config, local }),
      },
    };
  }

  private async apply({ output, config }: Plan, input: InitInput): Promise<InitOutput> {
    let phase = 'manifest';
    let registered = config.workspaces?.[output.name] !== undefined;
    let materialized = false;
    let prepared: object | null = null;
    let toolInstall: readonly ToolInstallOutput[] | null = null;
    try {
      await this.materialize(output, input);
      materialized = true;
      phase = 'validation';
      const bundle = await this.loadSourceManifest(output, input);
      let local = await initialLocalLayer(this.deps, output.name, output.root, bundle, input.repos);
      if (output.manifest === 'materialized')
        await this.deps.settleManifest(output.name, output.manifest_dir);
      phase = 'registration';
      await this.register(output, input);
      registered = true;
      if (input.repos !== undefined)
        local = await this.deps.localStore.update(output.name, (current) =>
          initialLocalLayer(this.deps, output.name, output.root, bundle, input.repos, current),
        );
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
      const done = completedInitialization(output, {
        sync,
        toolInstall,
        prepared,
        defaultWorkspace: (await this.deps.config.read()).default_workspace,
        repos: local.scope?.repos,
        shell: this.deps.commandShell,
      });
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

  private async loadSourceManifest(output: InitOutput, input: InitInput): Promise<ManifestBundle> {
    return new LoadManifest(this.deps.fs, this.deps.bundledTools)
      .execute({
        dir: output.manifest_dir,
        cliVersion: this.deps.cliVersion,
        providers: this.deps.providers,
      })
      .catch((error: unknown) => {
        throw initializationSourceError(
          this.deps,
          input,
          output,
          {
            root: output.manifest_dir,
            ...(output.manifest === 'refreshed' ? { contents: 'worktree' as const } : {}),
          },
          error,
        );
      });
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
      providers: this.deps.providers,
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

function nextSteps(root: string, sync: SyncOutput, shell?: ResolvedShell): string[] {
  const steps = [changeDirectoryCommand(root, shell), 'fx login --list', 'fx doctor'];
  for (const item of sync.items.filter((i) => i.action === 'unreadable')) {
    steps.push(
      `${item.name}: ${item.reason ?? 'unreadable'}${item.contact === undefined ? '' : `; ask ${item.contact}`}`,
    );
  }
  return steps;
}

interface CompletedInitialization {
  readonly sync: SyncOutput;
  readonly toolInstall: readonly ToolInstallOutput[];
  readonly prepared: object | null;
  readonly defaultWorkspace: string | undefined;
  readonly repos: readonly string[] | undefined;
  readonly shell: ResolvedShell | undefined;
}

function completedInitialization(output: InitOutput, result: CompletedInitialization): InitOutput {
  return {
    ...output,
    registered: true,
    default_workspace: result.defaultWorkspace === output.name,
    plan: {
      ...output.plan,
      source_inspected: true,
      inspected_source: output.manifest_dir,
      repositories: result.sync.items,
      unchecked: [],
      selection: { mode: scopeMode(result.repos), repos: result.repos ?? null, validated: true },
    },
    preparation_complete: result.sync.preparation_complete,
    sync: result.sync,
    tool_install: result.toolInstall,
    prepared: result.prepared,
    next_steps: nextSteps(output.root, result.sync, result.shell),
    written: true,
  };
}
