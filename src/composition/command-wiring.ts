// Every dependency a command uses, built from one invocation's context. The CLI base
// resolves that context from flags and settings; this module turns it into use-case
// inputs, and holds the instances that must stay single for the whole invocation.

import path from 'node:path';

import type { HarnessSession } from '../application/harness/session.js';
import type { HookSession } from '../application/hook/session.js';
import type { InitDeps } from '../application/init/types.js';
import type { LoginDeps } from '../application/login/deps.js';
import { loadManifestContext, type ManifestContext } from '../application/manifest/context.js';
import { replacementFor } from '../application/safety/replace-files.js';
import type { TrustContext } from '../application/safety/trust.js';
import type { SkillDeps } from '../application/skill/targets.js';
import type { SyncStageDeps } from '../application/sync/stages.js';
import { resolveToolchain, type Toolchain } from '../application/tool/toolchain.js';
import type { FxUpdateInput } from '../application/update/fx.js';
import { WorkspaceContext } from '../application/workspace/context.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import type { ResolveInput } from '../application/workspace/resolve.js';
import type { PreparationAction } from '../domain/preparation.js';
import type { ResolvedShell } from '../domain/shell.js';
import type { ReplaceFiles } from '../ports/replace-files.js';
import type { Reporter } from '../ports/reporter.js';

import {
  loginDeps,
  skillDeps,
  trustContext,
  workspaceDeps,
  type Container,
  type TrustInvocation,
} from './container.js';
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

export interface LifecycleSessions {
  readonly harness: HarnessSession;
  readonly hooks: HookSession;
}

export class CommandWiring {
  private replace: ReplaceFiles | undefined;

  constructor(private readonly input: CommandWiringInput) {}

  harnessInput(): HarnessCommandInput {
    const { container, resolve, env, cliVersion, noInput, yes, posture } = this.input;
    return { container, resolve, env, cliVersion, noInput, yes, posture };
  }

  // For a command that reaches a workspace's toolchain without its dependency bundle.
  trustFor(workspace: string): TrustContext {
    return trustContext(this.input.container, workspace, this.trustInvocation());
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
    const { container, reporter, cliVersion, user } = this.input;
    return workspaceDeps(container, { ctx, reporter, cliVersion, user, ...this.trustInvocation() });
  }

  skillDeps(): SkillDeps {
    return skillDeps(this.input.container, this.input.agents);
  }

  // Tool commands work outside a workspace too, on the bundled baseline.
  toolchain(workspace: () => Promise<WorkspaceContext>): Promise<Toolchain> {
    const { container, cliVersion, reporter } = this.input;
    return resolveToolchain({
      workspace,
      bundledTools: container.bundledTools,
      cliVersion,
      reporter,
    });
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

  lifecycleSessions(): LifecycleSessions {
    return { harness: harnessSession(this.input), hooks: hookSession(this.input) };
  }

  loginDeps(): LoginDeps {
    return loginDeps(this.input);
  }

  stageDeps(): SyncStageDeps {
    const { container, cliVersion } = this.input;
    return {
      ...this.lifecycleSessions(),
      inventory: toolInventory(container, cliVersion),
      replace: this.replacement(),
      login: this.loginDeps(),
      skills: this.skillDeps(),
    };
  }

  initDeps(): InitDeps {
    const { container, cliVersion, reporter, commandShell } = this.input;
    const { fs, git, config, localStore, bundledTools, providers, manifestDirFor } = container;
    return {
      fs,
      lock: container.lock,
      commandShell,
      git,
      config,
      localStore,
      bundledTools,
      providers,
      manifestDirFor,
      cliVersion,
      reporter,
      workspaceDepsFor: (ctx) => this.workspaceDeps(ctx),
      toolInstall: toolInstall(container),
      stages: this.stageDeps(),
      settleManifest: (name, dir) => this.updateChecks().manifest.markCurrent(name, dir),
    };
  }

  private trustInvocation(): TrustInvocation {
    const { commandShell, noInput, yes, posture } = this.input;
    return { commandShell, noInput, yes, posture };
  }
}
