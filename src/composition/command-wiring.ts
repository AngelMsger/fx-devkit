// Every dependency a command uses, built from one invocation's context. The CLI base
// resolves that context from flags and settings; this module turns it into use-case
// inputs, and holds the instances that must stay single for the whole invocation.

import path from 'node:path';

import type { DoctorExtension } from '../application/doctor/types.js';
import { harnessDoctor } from '../application/harness/stages.js';
import { hookDoctor, type HookSession } from '../application/hook/session.js';
import type { InitDeps } from '../application/init/types.js';
import type { LoginDeps } from '../application/login/deps.js';
import { Login } from '../application/login/run.js';
import { loadManifestContext, type ManifestContext } from '../application/manifest/context.js';
import { PreviewInitialization } from '../application/preview-initialization.js';
import { replacementFor } from '../application/safety/replace-files.js';
import { TrustGate } from '../application/safety/trust.js';
import { SkillStage } from '../application/skill/stage.js';
import type { SkillDeps } from '../application/skill/targets.js';
import { syncStages, type SyncStageInput } from '../application/sync/stages.js';
import type { SyncStages } from '../application/sync/types.js';
import { ToolInitialize } from '../application/tool/initialize.js';
import { workspaceToolScope } from '../application/tool/scope.js';
import { bundledToolchain, toolchainOf, type Toolchain } from '../application/tool/toolchain.js';
import type { FxUpdateInput } from '../application/update/fx.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import type { ResolveInput } from '../application/workspace/resolve.js';
import { WorkspaceContext } from '../application/workspace-context.js';
import type { PreparationAction } from '../domain/preparation.js';
import type { ResolvedShell } from '../domain/shell.js';
import type { ReplaceFiles } from '../ports/replace-files.js';
import type { Reporter } from '../ports/reporter.js';

import { loginDeps, skillDeps, workspaceDeps, type Container } from './container.js';
import { harnessSession, type HarnessCommandInput } from './harness.js';
import { hookSession } from './hooks.js';
import { toolInstall } from './tool-install.js';
import { toolInventory } from './tool-inventory.js';
import { updateChecks, type UpdateChecks } from './update.js';

export interface CommandWiringInput extends HarnessCommandInput {
  readonly commandShell: ResolvedShell;
  readonly reporter: Reporter;
  readonly agents: readonly string[] | undefined;
  readonly user: string | undefined;
}

export interface ResolveScope {
  readonly cwd: string;
  readonly selection: ResolveInput['selection'];
  readonly name: string | undefined;
  readonly commandShell: ResolvedShell;
  readonly reporter: Reporter;
}

export function resolveInputFor(container: Container, scope: ResolveScope): ResolveInput {
  const { selection, ...rest } = scope;
  return {
    ...rest,
    ...(selection === undefined ? {} : { selection }),
    config: container.config,
    fs: container.fs,
    diagnostics: container.diagnostics,
    manifestDirFor: container.manifestDirFor,
  };
}

export class CommandWiring {
  private trust: TrustGate | undefined;
  private replace: ReplaceFiles | undefined;

  constructor(private readonly input: CommandWiringInput) {}

  harnessInput(): HarnessCommandInput {
    const { container, resolve, env, cliVersion, noInput, yes, posture } = this.input;
    return { container, resolve, env, cliVersion, noInput, yes, posture };
  }

  trustGate(): TrustGate {
    const { container, noInput } = this.input;
    this.trust ??= new TrustGate(container.trust, container.prompter(noInput), container.clock);
    return this.trust;
  }

  replacement(): ReplaceFiles {
    const { container, noInput, reporter, yes } = this.input;
    this.replace ??= replacementFor(container.fs, container.prompter(noInput), reporter, yes);
    return this.replace;
  }

  locateWorkspace(): Promise<WorkspaceContext> {
    const { container, resolve, cliVersion } = this.input;
    return WorkspaceContext.locate({
      ...resolve,
      git: container.git,
      localStore: container.localStore,
      bundledTools: container.bundledTools,
      providers: container.providers,
      cliVersion,
    });
  }

  workspaceDeps(ctx: WorkspaceContext): WorkspaceDeps {
    const { container, reporter, cliVersion, user, commandShell } = this.input;
    return workspaceDeps(container, { ctx, reporter, cliVersion, user, commandShell });
  }

  skillDeps(): SkillDeps {
    return skillDeps(this.input.container, this.input.agents);
  }

  bundledToolchain(): Toolchain {
    return bundledToolchain(this.input.container.bundledTools(), this.input.cliVersion);
  }

  manifestContext(dir: string): Promise<ManifestContext> {
    const { container, cliVersion, reporter } = this.input;
    return loadManifestContext({
      dir,
      fs: container.fs,
      bundledTools: container.bundledTools,
      providers: container.providers,
      cliVersion,
      reporter,
      diagnostics: container.diagnostics,
    });
  }

  updateChecks(): UpdateChecks {
    return updateChecks(this.input.container);
  }

  async fxUpdateInput(packageName: string, resolveRegistry: boolean): Promise<FxUpdateInput> {
    const location = resolveRegistry
      ? await this.input.container.registryLocator.resolve(packageName)
      : undefined;
    return {
      current: this.input.cliVersion,
      packageName,
      registry: location?.registry ?? null,
      ...(location ? { registrySource: location.source } : {}),
    };
  }

  // The homes a printed recovery command must run against to reach this same state.
  recoveryEnv(): NonNullable<PreparationAction['env']> {
    const { container, env } = this.input;
    return {
      FX_HOME: path.resolve(container.fxHome),
      HOME: path.resolve(container.userHome),
      USERPROFILE: path.resolve(container.userHome),
      ...(env.FX_AGENTS !== undefined ? { FX_AGENTS: env.FX_AGENTS } : {}),
    };
  }

  hookDoctorChecks(): DoctorExtension[] {
    const harness = harnessSession(this.input);
    return [
      harnessDoctor(harness, 'mcp'),
      harnessDoctor(harness, 'rules'),
      hookDoctor(this.hookSessionFor(this.input.resolve.name)),
    ];
  }

  private hookSessionFor(name: string | undefined): HookSession {
    return hookSession({
      container: this.input.container,
      resolve: { ...this.input.resolve, name },
      env: this.input.env,
      posture: this.input.posture,
    });
  }

  loginDeps(): LoginDeps {
    return loginDeps({ ...this.input, gate: this.trustGate() });
  }

  initDeps(): InitDeps {
    const { fs, git, config, localStore, bundledTools, providers, manifestDirFor } =
      this.input.container;
    const depsFor = (ctx: WorkspaceContext): WorkspaceDeps => this.workspaceDeps(ctx);
    return {
      fs,
      lock: this.input.container.lock,
      commandShell: this.input.commandShell,
      git,
      config,
      localStore,
      bundledTools,
      providers,
      manifestDirFor,
      cliVersion: this.input.cliVersion,
      reporter: this.input.reporter,
      workspaceDepsFor: depsFor,
      preview: (ctx) => this.previewInit(depsFor(ctx)),
      installTools: (ctx) =>
        new ToolInitialize(toolInstall(this.input.container)).execute({
          tools: toolchainOf(ctx).tools,
          commandShell: this.input.commandShell,
          posture: this.input.posture,
          trust: {
            gate: this.trustGate(),
            workspace: ctx.name,
            commandShell: this.input.commandShell,
            yes: this.input.yes,
            posture: this.input.posture,
          },
        }),
      stagesFor: (ctx) =>
        syncStages({ ...this.stageWiring(depsFor(ctx), false), initialize: true }),
      setupPlan: (ctx) =>
        new Login(depsFor(ctx), this.loginDeps()).plan({
          tools: workspaceToolScope(ctx, {}).configuredNames,
        }),
      settleManifest: (name, dir) => this.updateChecks().manifest.markCurrent(name, dir),
    };
  }

  private previewInit(deps: WorkspaceDeps): Promise<object> {
    return new PreviewInitialization(
      deps,
      this.loginDeps(),
      toolInstall(this.input.container),
      new SkillStage(deps, this.skillDeps()),
    ).execute({
      gate: this.trustGate(),
      workspace: deps.ctx.name,
      commandShell: deps.commandShell,
      yes: this.input.yes,
      posture: this.input.posture,
      dryRun: true,
    });
  }

  stages(deps: WorkspaceDeps, dryRun: boolean): SyncStages {
    return syncStages(this.stageWiring(deps, dryRun));
  }

  private stageWiring(deps: WorkspaceDeps, dryRun: boolean): SyncStageInput {
    return {
      inventory: toolInventory(this.input.container, this.input.cliVersion),
      harness: harnessSession({
        ...this.input,
        resolve: { ...this.input.resolve, name: deps.ctx.name },
      }),
      hooks: this.hookSessionFor(deps.ctx.name),
      deps,
      replace: this.replacement(),
      login: this.loginDeps(),
      skills: this.skillDeps(),
      process: this.input.container.process,
      trust: {
        gate: this.trustGate(),
        workspace: deps.ctx.name,
        commandShell: deps.commandShell,
        yes: this.input.yes,
        posture: this.input.posture,
      },
      dryRun,
      posture: this.input.posture,
    };
  }
}
