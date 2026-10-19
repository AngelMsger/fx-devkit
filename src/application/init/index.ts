// Materialize, validate and register a workspace before synchronizing its resources.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { samePath, windowsPathProblem } from '../../domain/path.js';
import { preparation, preparationScope } from '../../domain/preparation.js';
import {
  assertWorkspaceName,
  assertWorkspaceNames,
  defaultWorkspaceName,
} from '../../domain/workspace/name.js';
import type { ConfigFile } from '../../ports/stores.js';
import { LoadManifest, type ManifestBundle } from '../manifest/load.js';
import { requireUsableManifest } from '../manifest/prepare.js';
import { RefreshManifest } from '../manifest/refresh.js';
import { assertWritable } from '../safety/posture.js';
import { Sync } from '../sync/index.js';
import type { SyncOutput } from '../sync/types.js';
import type { ToolInstallOutput } from '../tool/install.js';
import { WorkspaceContext } from '../workspace/context.js';
import { assertNoWorkspaceOperation } from '../workspace/health.js';
import { withWorkspaceOperation } from '../workspace/operation.js';
import { assertDistinctWorkspaceRoot } from '../workspace/registry.js';
import { scopeMode } from '../workspace/scope.js';

import {
  initFailure,
  initializationSourceError,
  nameTaken,
  sourceMismatch,
  type InitPhase,
} from './errors.js';
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
      const plan = await this.plan({ ...input, name: preview.output.name });
      return this.apply(plan, input);
    });
  }

  private async identity(
    input: InitInput,
  ): Promise<{ root: string; name: string; config: ConfigFile }> {
    const root = path.resolve(input.dir);
    if (root === path.parse(root).root)
      throw new DevkitError(
        'usage',
        'WORKSPACE_PATH_INVALID',
        'Choose a workspace directory below the filesystem root',
        { nextSteps: ['fx init <workspace-directory> --from <source>'] },
      );
    const problem = path.sep === '\\' ? windowsPathProblem(root) : undefined;
    if (problem)
      throw new DevkitError('usage', 'WORKSPACE_PATH_INVALID', problem, {
        nextSteps: [`Choose a local workspace directory Windows can address instead of ${root}.`],
      });
    const config = await this.deps.config.read();
    let name = input.name;
    if (name === undefined) {
      for (const [registeredName, entry] of Object.entries(config.workspaces ?? {})) {
        if (await this.sameRoot(entry.root, root)) {
          name = registeredName;
          break;
        }
      }
    }
    name ??= defaultWorkspaceName(root, Object.keys(config.workspaces ?? {}));
    assertWorkspaceName(name);
    assertWorkspaceNames([...new Set([...Object.keys(config.workspaces ?? {}), name])]);
    await assertNoWorkspaceOperation(this.deps, {
      name,
      manifestDir: this.deps.manifestDirFor(name),
    });
    await assertDistinctWorkspaceRoot(config, name, root, this.deps);
    const existing = config.workspaces?.[name];
    if (input.resume && existing === undefined)
      throw new DevkitError(
        'not_found',
        'WORKSPACE_NOT_FOUND',
        `Workspace ${name} is not registered`,
        { nextSteps: ['fx workspace list'] },
      );
    if (existing !== undefined && !(await this.sameRoot(existing.root, root)))
      throw nameTaken(this.deps, name, root, existing);
    if (existing?.source !== undefined && existing.source !== input.source.description)
      throw sourceMismatch(this.deps, name, existing.source, input.source);
    return { root, name, config };
  }

  private async plan(input: InitInput): Promise<Plan> {
    const { root, name, config } = await this.identity(input);
    const existing = config.workspaces?.[name];
    const state = await this.dirState(root, existing !== undefined);
    if (state === 'adopted') await this.warnIfRepository(root);
    const manifestDir = this.deps.manifestDirFor(name);
    const refreshed =
      existing !== undefined &&
      input.source.refresh !== undefined &&
      (await this.deps.fs.exists(manifestDir));
    const local = await this.deps.localStore.read(name);
    let manifest: InitOutput['manifest'] = refreshed ? 'refreshed' : 'materialized';
    if (input.resume) manifest = 'kept';
    return {
      config,
      output: {
        operation: input.dryRun ? 'preview' : 'apply',
        preparation: preparation({ scope: preparationScope(name), checks: [], preview: true }),
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
        written: false,
        plan: initialPlan(this.deps, input, { name, root, manifestDir, refreshed, config, local }),
      },
    };
  }

  private async apply({ output, config }: Plan, input: InitInput): Promise<InitOutput> {
    let phase: InitPhase = 'manifest';
    let registered = config.workspaces?.[output.name] !== undefined;
    let materialized = false;
    let prepared: object | null = null;
    let toolInstall: readonly ToolInstallOutput[] | null = null;
    try {
      phase = 'validation';
      output = await this.inspectSource(output, input, false);
      phase = 'manifest';
      if (!input.resume) await this.materialize(output, input);
      materialized = true;
      phase = 'validation';
      const bundle = await this.loadSourceManifest(output, input);
      requireUsableManifest(bundle);
      output = await this.inspectSource(output, input, true);
      let local = await initialLocalLayer(this.deps, output.name, output.root, bundle, input.repos);
      if (output.manifest === 'materialized')
        await this.deps.settleManifest(output.name, output.manifest_dir);
      phase = 'registration';
      await this.register(output, input);
      registered = true;
      await this.deps.fs.ensureDir(output.root);
      if (input.repos !== undefined)
        local = await this.deps.localStore.update(output.name, (current) =>
          initialLocalLayer(this.deps, output.name, output.root, bundle, input.repos, current),
        );
      phase = 'tools';
      const ctx = await this.context(output);
      prepared = (await this.deps.preview?.(ctx)) ?? null;
      toolInstall = (await this.deps.installTools?.(ctx)) ?? [];
      phase = 'sync';
      const sync = await new Sync(this.deps.workspaceDepsFor(ctx)).execute({
        initializing: true,
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
      });
      return done;
    } catch (error) {
      throw initFailure(this.deps, output, error, {
        phase,
        registered,
        materialized,
        prepared,
        toolInstall,
        cwd: path.resolve('.'),
      });
    }
  }

  private async inspectSource(
    output: InitOutput,
    input: InitInput,
    materialized: boolean,
  ): Promise<InitOutput> {
    const inspection = materialized
      ? {
          root: output.manifest_dir,
          contents: 'worktree' as const,
          readText: (file: string) => this.deps.fs.readText(path.join(output.manifest_dir, file)),
        }
      : await input.source.inspect?.(
          output.plan.manifest_action === 'refresh' ? output.manifest_dir : undefined,
        );
    if (!inspection) return output;
    return { ...output, plan: await inspectInitialization(this.deps, input, output, inspection) };
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
      await assertDistinctWorkspaceRoot(current, output.name, output.root, this.deps);
      const existing = current.workspaces?.[output.name];
      if (existing && !(await this.sameRoot(existing.root, output.root)))
        throw nameTaken(this.deps, output.name, output.root, existing);
      if (existing?.source !== undefined && existing.source !== output.source)
        throw sourceMismatch(this.deps, output.name, existing.source, input.source);
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
    if (!(await this.deps.fs.isDirectory(root)))
      throw new DevkitError(
        'conflict',
        'WORKSPACE_PATH_INVALID',
        `The workspace destination is not a directory: ${root}`,
        {
          nextSteps: [
            'Choose a directory while preserving the existing file, then retry initialization.',
          ],
        },
      );
    if (registered) return 'registered';
    if ((await this.deps.fs.readDir(root)).length === 0) return 'empty';
    return 'adopted';
  }

  private async warnIfRepository(root: string): Promise<void> {
    if (!(await this.deps.git.isToplevel(root))) return;
    this.deps.reporter.notice({
      code: 'ROOT_IS_GIT',
      message: `${root} is itself a git repository; the workspace root should be a plain directory`,
      nextSteps: [
        'Preserve this repository; choose a separate plain directory if you need a workspace root.',
      ],
    });
  }
}

interface CompletedInitialization {
  readonly sync: SyncOutput;
  readonly toolInstall: readonly ToolInstallOutput[];
  readonly prepared: object | null;
  readonly defaultWorkspace: string | undefined;
  readonly repos: readonly string[] | undefined;
}

function completedInitialization(output: InitOutput, result: CompletedInitialization): InitOutput {
  const { preparation, ...sync } = result.sync;
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
    preparation,
    sync,
    tool_install: result.toolInstall,
    prepared: result.prepared,
    written: true,
  };
}
