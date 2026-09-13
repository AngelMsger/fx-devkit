// Feature wiring shared by commands; the CLI base only supplies invocation context.
import type { DoctorExtension } from '../application/doctor/types.js';
import type { InitDeps } from '../application/init.js';
import type { LoginDeps } from '../application/login/deps.js';
import { PreviewInitialization } from '../application/preview-initialization.js';
import type { TrustGate } from '../application/safety/trust.js';
import { SkillStage } from '../application/skill/stage.js';
import { syncStages, type SyncStageInput } from '../application/sync/stages.js';
import type { SyncStages } from '../application/sync.js';
import { ToolInitialize } from '../application/tool/initialize.js';
import { ToolInstall } from '../application/tool/install.js';
import { toolchainOf } from '../application/tool/toolchain.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import type { WorkspaceContext } from '../application/workspace-context.js';
import type { ResolvedShell } from '../domain/shell.js';
import type { ReplaceFiles } from '../ports/replace-files.js';
import type { Reporter } from '../ports/reporter.js';

import { skillDeps, workspaceDeps } from './container.js';
import { harnessDoctor, harnessStage } from './harness-stages.js';
import type { HarnessCommandInput } from './harness.js';
import { hookDoctor, hookStage } from './hooks.js';
import { updateChecks } from './update.js';

export interface CommandServiceInput extends HarnessCommandInput {
  readonly commandShell?: ResolvedShell;
  readonly reporter: Reporter;
  readonly replace: ReplaceFiles;
  readonly trust: TrustGate;
  readonly agents: readonly string[] | undefined;
  readonly user: string | undefined;
}

export class CommandServices {
  constructor(private readonly input: CommandServiceInput) {}

  hookDoctorChecks(): DoctorExtension[] {
    return [
      harnessDoctor(this.input, 'mcp'),
      harnessDoctor(this.input, 'rules'),
      hookDoctor({
        container: this.input.container,
        resolve: this.input.resolve,
        env: this.input.env,
        posture: this.input.posture,
      }),
    ];
  }

  loginDeps(): LoginDeps {
    return {
      describeProvider: this.input.container.describeProvider,
      prompter: this.input.container.prompter(this.input.noInput),
      clock: this.input.container.clock,
      home: this.input.container.userHome,
      trust: { gate: this.input.trust, yes: this.input.yes, posture: this.input.posture },
    };
  }

  initDeps(): InitDeps {
    const { fs, git, config, localStore, bundledTools, manifestDirFor } = this.input.container;
    const depsFor = (ctx: WorkspaceContext): WorkspaceDeps =>
      workspaceDeps(
        this.input.container,
        ctx,
        this.input.reporter,
        this.input.cliVersion,
        this.input.user,
      );
    return {
      fs,
      commandShell: this.input.commandShell,
      git,
      config,
      localStore,
      bundledTools,
      manifestDirFor,
      cliVersion: this.input.cliVersion,
      reporter: this.input.reporter,
      workspaceDepsFor: depsFor,
      preview: (ctx) => this.previewInit(ctx, depsFor(ctx)),
      installTools: (ctx) =>
        new ToolInitialize(
          new ToolInstall(this.input.container.installers, this.input.container.process),
        ).execute({
          tools: toolchainOf(ctx).tools,
          posture: this.input.posture,
          trust: {
            gate: this.input.trust,
            workspace: ctx.name,
            yes: this.input.yes,
            posture: this.input.posture,
          },
        }),
      stagesFor: (ctx) => this.stages(depsFor(ctx), false),
      settleManifest: (name, dir) =>
        updateChecks(this.input.container).manifest.markCurrent(name, dir),
    };
  }

  private previewInit(ctx: WorkspaceContext, deps: WorkspaceDeps): Promise<object> {
    return new PreviewInitialization(
      new ToolInstall(this.input.container.installers, this.input.container.process),
      new SkillStage(deps, skillDeps(this.input.container, this.input.agents)),
    ).execute(ctx, {
      gate: this.input.trust,
      workspace: ctx.name,
      yes: this.input.yes,
      posture: this.input.posture,
      dryRun: true,
    });
  }

  stages(deps: WorkspaceDeps, dryRun: boolean): SyncStages {
    return syncStages(this.stageWiring(deps, dryRun));
  }

  private stageWiring(deps: WorkspaceDeps, dryRun: boolean): SyncStageInput {
    const harness = {
      ...this.input,
      resolve: { ...this.input.resolve, name: deps.ctx.name },
      action: 'sync' as const,
      dryRun,
    };
    return {
      mcp: harnessStage({ ...harness, only: 'mcp' }),
      rules: harnessStage({ ...harness, only: 'rules' }),
      hooks: hookStage({
        container: this.input.container,
        resolve: { ...this.input.resolve, name: deps.ctx.name },
        env: this.input.env,
        posture: this.input.posture,
        dryRun,
      }),
      deps,
      replace: this.input.replace,
      login: this.loginDeps(),
      skills: skillDeps(this.input.container, this.input.agents),
      process: this.input.container.process,
      trust: {
        gate: this.input.trust,
        workspace: deps.ctx.name,
        yes: this.input.yes,
        posture: this.input.posture,
      },
      dryRun,
      posture: this.input.posture,
    };
  }
}
