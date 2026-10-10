// Feature wiring shared by commands; the CLI base only supplies invocation context.
import type { DoctorExtension } from '../application/doctor/types.js';
import { harnessDoctor } from '../application/harness/stages.js';
import { hookDoctor, type HookSession } from '../application/hook/session.js';
import type { InitDeps } from '../application/init/types.js';
import type { LoginDeps } from '../application/login/deps.js';
import { Login } from '../application/login/run.js';
import { PreviewInitialization } from '../application/preview-initialization.js';
import type { TrustGate } from '../application/safety/trust.js';
import { SkillStage } from '../application/skill/stage.js';
import { syncStages, type SyncStageInput } from '../application/sync/stages.js';
import type { SyncStages } from '../application/sync/types.js';
import { ToolInitialize } from '../application/tool/initialize.js';
import { workspaceToolScope } from '../application/tool/scope.js';
import { toolchainOf } from '../application/tool/toolchain.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import type { WorkspaceContext } from '../application/workspace-context.js';
import type { ResolvedShell } from '../domain/shell.js';
import type { ReplaceFiles } from '../ports/replace-files.js';
import type { Reporter } from '../ports/reporter.js';

import { loginDeps, skillDeps, workspaceDeps } from './container.js';
import { harnessSession, type HarnessCommandInput } from './harness.js';
import { hookSession } from './hooks.js';
import { toolInstall } from './tool-install.js';
import { toolInventory } from './tool-inventory.js';
import { updateChecks } from './update.js';

export interface CommandWiringInput extends HarnessCommandInput {
  readonly commandShell?: ResolvedShell;
  readonly reporter: Reporter;
  readonly replace: ReplaceFiles;
  readonly trust: TrustGate;
  readonly agents: readonly string[] | undefined;
  readonly user: string | undefined;
}

export class CommandWiring {
  constructor(private readonly input: CommandWiringInput) {}

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
    return loginDeps({ ...this.input, gate: this.input.trust });
  }

  initDeps(): InitDeps {
    const { fs, git, config, localStore, bundledTools, providers, manifestDirFor } =
      this.input.container;
    const depsFor = (ctx: WorkspaceContext): WorkspaceDeps =>
      workspaceDeps(this.input.container, {
        ctx,
        reporter: this.input.reporter,
        cliVersion: this.input.cliVersion,
        user: this.input.user,
        commandShell: this.input.commandShell,
      });
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
            gate: this.input.trust,
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
      settleManifest: (name, dir) =>
        updateChecks(this.input.container).manifest.markCurrent(name, dir),
    };
  }

  private previewInit(deps: WorkspaceDeps): Promise<object> {
    return new PreviewInitialization(
      deps,
      this.loginDeps(),
      toolInstall(this.input.container),
      new SkillStage(deps, skillDeps(this.input.container, this.input.agents)),
    ).execute({
      gate: this.input.trust,
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
      replace: this.input.replace,
      login: this.loginDeps(),
      skills: skillDeps(this.input.container, this.input.agents),
      process: this.input.container.process,
      trust: {
        gate: this.input.trust,
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
