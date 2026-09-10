// init: make a workspace from a manifest source. The source lands under ~/.fx, the root
// only ever receives checkouts and the derived documents, and the registry decides
// identity: a second run on a registered root is a refresh, a run with another source is
// a conflict.

import path from 'node:path';

import { DevkitError } from '../domain/errors.js';
import { samePath, windowsPathProblem } from '../domain/path.js';
import { changeDirectoryCommand, type ResolvedShell } from '../domain/shell.js';
import { assertWorkspaceName, assertWorkspaceNames } from '../domain/workspace/name.js';
import type { FileSystem } from '../ports/fs.js';
import type { Git } from '../ports/git.js';
import type { ManifestSource } from '../ports/manifest-source.js';
import type { Reporter } from '../ports/reporter.js';
import type { ConfigFile, ConfigStore, LocalLayerStore, WorkspaceEntry } from '../ports/stores.js';

import { LoadManifest } from './manifest/load.js';
import { RefreshManifest } from './refresh-manifest.js';
import { assertWritable, type WritePosture } from './safety/posture.js';
import { Sync, type SyncOutput, type SyncStages } from './sync.js';
import type { ToolInstallOutput } from './tool/install.js';
import type { WorkspaceDeps } from './workspace/deps.js';
import { WorkspaceContext } from './workspace-context.js';

export interface InitDeps {
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
    const plan = await this.plan(input);
    if (input.dryRun) return plan.output;
    assertWritable(input.posture, `init ${plan.output.root}`);
    return this.apply(plan, input);
  }

  private async plan(input: InitInput): Promise<Plan> {
    const root = path.resolve(input.dir);
    const problem = path.sep === '\\' ? windowsPathProblem(root) : undefined;
    if (problem) throw new DevkitError('usage', 'WORKSPACE_PATH_INVALID', problem);
    const name = input.name ?? path.basename(root);
    assertWorkspaceName(name);
    const config = await this.deps.config.read();
    assertWorkspaceNames([...new Set([...Object.keys(config.workspaces ?? {}), name])]);
    const existing = config.workspaces?.[name];
    if (
      existing !== undefined &&
      !samePath(await this.deps.fs.realpath(existing.root), await this.deps.fs.realpath(root))
    )
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
    const { output, config } = plan;
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
    await new LoadManifest(this.deps.fs, this.deps.bundledTools).execute({
      dir: output.manifest_dir,
      cliVersion: this.deps.cliVersion,
    });
    if (output.manifest === 'materialized')
      await this.deps.settleManifest(output.name, output.manifest_dir);
    await this.deps.config.write({
      ...config,
      ...(output.default_workspace ? { default_workspace: output.name } : {}),
      workspaces: {
        ...config.workspaces,
        [output.name]: { root: output.root, source: output.source },
      },
    });
    const ctx = await WorkspaceContext.locate({
      cwd: output.root,
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
    const toolInstall = (await this.deps.installTools?.(ctx)) ?? [];
    const sync = await new Sync(this.deps.workspaceDepsFor(ctx)).execute({
      dryRun: false,
      posture: input.posture,
      jobs: input.jobs,
      stages: this.deps.stagesFor(ctx),
    });
    const done = {
      ...output,
      sync,
      tool_install: toolInstall,
      next_steps: nextSteps(output.root, sync, this.deps.commandShell),
      written: true,
    };
    this.deps.reporter.notice({
      code: 'INIT_DONE',
      message: `workspace ${done.name} is registered at ${done.root}; inspect synchronization results and doctor readiness`,
      nextSteps: done.next_steps,
    });
    return done;
  }

  private async dirState(root: string, registered: boolean): Promise<DirState> {
    if (!(await this.deps.fs.exists(root))) return 'new';
    if (registered) return 'registered';
    if ((await this.deps.fs.readDir(root)).length === 0) return 'empty';
    return 'adopted';
  }

  // The root is a plain directory; one that is itself a repository will
  // confuse tools and people, and fx never runs git there.
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
      hint: 'Pick another name with --name, or init into the registered directory.',
      nextSteps: [
        'fx config get default_workspace',
        `fx init ${root} --from ${source.description} --name <other>`,
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
      hint: 'fx does not swap one manifest source for another; register the directory under another name or keep the recorded source.',
      nextSteps: [`fx init <dir> --from ${recorded}`, 'fx self info'],
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
