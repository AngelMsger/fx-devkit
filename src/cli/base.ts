// The command base. It resolves the global flags in a lenient pre-parse so
// the renderer and posture exist before the command's own strict parse, and
// it is the single error boundary: whatever escapes a command leaves through
// the renderer's error contract on stderr and a category exit code.

import path from 'node:path';

import { Command, Errors } from '@oclif/core';

import { readSettings } from '../application/config/settings.js';
import type { DoctorExtension } from '../application/doctor/types.js';
import type { InitDeps } from '../application/init/types.js';
import type { LoginDeps } from '../application/login/deps.js';
import { loadManifestContext, type ManifestContext } from '../application/manifest/context.js';
import { resolveManifestDir } from '../application/manifest/locate.js';
import { resolvePosture, type WritePosture } from '../application/safety/posture.js';
import { replacementFor } from '../application/safety/replace-files.js';
import { TrustGate } from '../application/safety/trust.js';
import type { SkillDeps } from '../application/skill/targets.js';
import type { SyncStages } from '../application/sync/types.js';
import { bundledToolchain, toolchainOf, type Toolchain } from '../application/tool/toolchain.js';
import type { FxUpdateInput } from '../application/update/fx.js';
import { beginWorkspaceCommand } from '../application/workspace/command-operation.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import type { ResolveInput } from '../application/workspace/resolve.js';
import { WorkspaceContext } from '../application/workspace-context.js';
import { fxExecutable } from '../composition/bundled.js';
import { CommandWiring } from '../composition/command-wiring.js';
import {
  createContainer,
  skillDeps,
  workspaceDeps,
  type Container,
} from '../composition/container.js';
import type { HarnessCommandInput } from '../composition/harness.js';
import { updateChecks, type UpdateChecks } from '../composition/update.js';
import { causeChain } from '../domain/diagnostics.js';
import { asDevkitError, DevkitError, exitCodeFor } from '../domain/errors.js';
import { DEFAULT_FORMAT, isFormat, type Format } from '../domain/format.js';
import type { Preparation, PreparationAction, PreparationCheck } from '../domain/preparation.js';
import type { Report } from '../domain/report.js';
import { resolveCommandShell, type ResolvedShell } from '../domain/shell.js';
import type { Lease } from '../ports/lock.js';
import type { ReplaceFiles } from '../ports/replace-files.js';

import { globalFlags } from './flags.js';
import { invocationFormat, UNDECIDED_FORMAT } from './invocation-format.js';
import { preparationText } from './preparation-view.js';
import {
  createRenderer,
  parseFields,
  processIo,
  type RenderOptions,
  type Renderer,
} from './render/index.js';
import { reportCommand } from './render/report.js';
import { SinkReporter } from './reporter.js';
import { invocation } from './trace.js';
import { shouldCheckUpdates, updateNotices } from './update-notices.js';
import { workspaceWriteMode } from './workspace-write-policy.js';

export abstract class FxCommand extends Command {
  static baseFlags = globalFlags;
  protected readonly container: Container = createContainer(process.env);
  protected renderer: Renderer = createRenderer(UNDECIDED_FORMAT, processIo());
  private reportSink: SinkReporter | undefined;
  protected noInput = false;
  protected yes = false;
  protected posture: WritePosture = { readOnly: false, source: 'default' };
  protected format: Format = DEFAULT_FORMAT;
  // What the renderer was built with: a command that decides which rows to hand
  // it reads the same projection settings instead of parsing the flags again.
  protected renderOptions: RenderOptions = {};
  protected commandShell: ResolvedShell = 'posix';
  private workspaceName: string | undefined;
  private configUser: string | undefined;
  private configAgentList: readonly string[] | undefined;
  // Off until init has read the configuration; a command that failed before
  // then must not go looking upstream.
  private updateCheckOn = false;
  private quietOn = false;
  private located: WorkspaceContext | undefined;
  // One instance each per execution: a second TrustGate would ask again for
  // approval the first one already holds.
  private commandWiring: CommandWiring | undefined;
  private trust: TrustGate | undefined;
  private replaceFiles: ReplaceFiles | undefined;
  private operationLease: Lease | undefined;
  private selection: ResolveInput['selection'];

  protected get commandName(): string {
    return `fx ${(this.id ?? '').replaceAll(':', ' ')}`.trim();
  }

  // Resolve and connect output before acquiring the workspace lease so lock
  // failures use the requested format and retain diagnostics.
  protected override async init(): Promise<void> {
    await super.init();
    const file = await this.container.config.read();
    // The parse below already rejects an unknown flag, and that error has to read the
    // way the caller asked.
    this.renderer = createRenderer(invocationFormat(this.argv, process.env, file), processIo());
    const spec = this.constructor as typeof FxCommand & { flags?: object; args?: object };
    const { flags } = await this.parse({ ...spec, baseFlags: globalFlags, strict: false });
    const settings = readSettings({
      env: process.env,
      file,
      flags: { command_shell: flags['command-shell'], format: flags.format },
    });
    this.commandShell = resolveCommandShell(settings.commandShell, process.platform === 'win32');
    this.configUser = settings.user;
    this.configAgentList = settings.agents;
    this.updateCheckOn = settings.updateCheck;
    const format = settings.format;
    if (format !== undefined && !isFormat(format)) {
      throw new DevkitError('config', 'CONFIG_INVALID', `Unknown output format "${format}"`, {
        hint: `Choose one of: human, json, ndjson.`,
        nextSteps: ['fx config set format human', 'Unset FX_FORMAT if it supplies this value.'],
      });
    }
    this.format = format ?? DEFAULT_FORMAT;
    this.renderOptions = {
      report: reportCommand(this.id),
      details: flags['details'] === true,
      fields: parseFields(flags.fields),
      quiet: flags.quiet,
      verbose: flags.verbose,
      noHeader: flags['no-header'],
      shell: this.commandShell,
    };
    this.renderer = createRenderer(this.format, processIo(), this.renderOptions);
    this.container.diagnostics.connect(this.renderer);
    this.noInput = flags['no-input'] || !process.stdin.isTTY;
    this.quietOn = flags.quiet;
    this.yes = flags.yes;
    this.workspaceName = flags.workspace;
    this.posture = resolvePosture({ allowWrites: flags['allow-writes'], env: process.env, file });
    const mode = workspaceWriteMode(this.id, flags);
    if (mode !== null && !this.posture.readOnly) {
      const operation = await beginWorkspaceCommand(
        this.resolveInput(),
        this.container.lock,
        mode === 'source',
      );
      if (operation) {
        this.operationLease = operation.lease;
        this.workspaceName = operation.located.name;
        this.selection = operation.located.selection;
      }
    }
  }

  protected get configAgents(): readonly string[] | undefined {
    return this.configAgentList;
  }

  protected get user(): string | undefined {
    return this.configUser;
  }

  // One reporter for the whole command. It reads `renderer` per call, because
  // init replaces the default renderer once the output format is known.
  protected get reporter(): SinkReporter {
    this.reportSink ??= new SinkReporter({
      notice: (notice) => this.renderer.notice(notice),
      progress: (event) => this.renderer.progress(event),
    });
    return this.reportSink;
  }

  // A human reader wants the findings as a table; every other format keeps the
  // whole report, which the renderer also needs to honour --fields and --details.
  protected renderReport(report: Report, columns: readonly string[]): void {
    if (this.format === 'human')
      this.renderer.list(report.findings, { fullReport: report, columns });
    else this.renderer.record(report);
  }

  protected async renderPreparation<T extends { readonly preparation: Preparation }>(
    value: T,
    exitIncomplete = true,
  ): Promise<void> {
    const bound = this.bindPreparation(value.preparation, fxExecutable());
    const result = { ...value, preparation: bound };
    const viewed = this.format === 'human' && !this.renderOptions.fields;
    if (viewed) {
      // A person types `fx`; the exact executable matters only where PATH cannot reach it.
      const spoken = (await this.container.process.which('fx'))
        ? this.bindPreparation(value.preparation, ['fx'])
        : bound;
      this.renderer.text(
        preparationText(
          { ...value, preparation: spoken },
          {
            shell: this.commandShell,
            display: this.renderer.display.out,
            includeEnvironment: process.env.FX_HOME !== undefined,
          },
        ),
      );
      if (this.renderOptions.details || this.renderOptions.verbose) this.renderer.record(result);
    } else this.renderer.record(result);
    if (bound.state === 'incomplete' && exitIncomplete) {
      const error = new DevkitError(
        'incomplete',
        'PREPARATION_INCOMPLETE',
        'Required workspace preparation is unfinished',
        {
          nextSteps: [
            bound.next.message,
            'Use preparation.next_actions for Agent work; preparation.resume continues after the blockers change.',
          ],
        },
      );
      // The view already told a person watching both streams; anyone else reads the error.
      const { out, err } = this.renderer.display;
      if (!(viewed && out.interactive && err.interactive)) this.renderer.error(error);
      invocation.trace?.failed(error);
      this.exit(exitCodeFor('incomplete'));
    }
  }

  private bindPreparation(preparation: Preparation, executable: readonly string[]): Preparation {
    const bind = (action: PreparationAction): PreparationAction =>
      this.bindRecoveryAction(action, executable);
    const bindCheck = (check: PreparationCheck): PreparationCheck => ({
      ...check,
      ...(check.actions ? { actions: check.actions.map(bind) } : {}),
    });
    return {
      ...preparation,
      next_actions: preparation.next_actions.map(bind),
      resume: preparation.resume ? bind(preparation.resume) : null,
      blockers: preparation.blockers.map(bindCheck),
      warnings: preparation.warnings.map(bindCheck),
      unchecked: preparation.unchecked.map(bindCheck),
    };
  }

  private bindRecoveryAction(
    action: PreparationAction,
    executable: readonly string[],
  ): PreparationAction {
    if (action.argv[0] !== 'fx') return action;
    return {
      ...action,
      argv: [
        ...executable,
        ...action.argv.slice(1),
        ...(this.format === 'human' ? [] : ['--format', this.format]),
      ],
      env: {
        FX_HOME: path.resolve(this.container.fxHome),
        HOME: path.resolve(this.container.userHome),
        USERPROFILE: path.resolve(this.container.userHome),
        ...(process.env.FX_AGENTS !== undefined ? { FX_AGENTS: process.env.FX_AGENTS } : {}),
      },
    };
  }

  protected async workspaceDeps(): Promise<WorkspaceDeps> {
    const deps = workspaceDeps(
      this.container,
      await this.workspace(),
      this.reporter,
      this.config.version,
      this.configUser,
    );
    return { ...deps, commandShell: this.commandShell };
  }

  protected harnessInput(): HarnessCommandInput {
    return {
      container: this.container,
      resolve: this.resolveInput(),
      env: process.env,
      cliVersion: this.config.version,
      noInput: this.noInput,
      yes: this.yes,
      posture: this.posture,
    };
  }

  private wiring(): CommandWiring {
    this.commandWiring ??= new CommandWiring({
      commandShell: this.commandShell,
      ...this.harnessInput(),
      reporter: this.reporter,
      replace: this.replacement(),
      trust: this.trustGate(),
      agents: this.configAgents,
      user: this.user,
    });
    return this.commandWiring;
  }

  protected hookDoctorChecks(): DoctorExtension[] {
    return this.wiring().hookDoctorChecks();
  }
  protected loginDeps(): LoginDeps {
    return this.wiring().loginDeps();
  }
  protected initDeps(): InitDeps {
    return this.wiring().initDeps();
  }
  protected stages(deps: WorkspaceDeps, dryRun: boolean): SyncStages {
    return this.wiring().stages(deps, dryRun);
  }

  protected skillDeps(): SkillDeps {
    return skillDeps(this.container, this.configAgents);
  }

  protected replacement(): ReplaceFiles {
    this.replaceFiles ??= replacementFor(
      this.container.fs,
      this.container.prompter(this.noInput),
      this.reporter,
      this.yes,
    );
    return this.replaceFiles;
  }

  protected trustGate(): TrustGate {
    this.trust ??= new TrustGate(
      this.container.trust,
      this.container.prompter(this.noInput),
      this.container.clock,
    );
    return this.trust;
  }

  // Tool commands work outside a workspace too, on the bundled baseline.
  protected async toolchain(): Promise<Toolchain> {
    try {
      return toolchainOf(await this.workspace());
    } catch (err) {
      if (!(err instanceof DevkitError) || err.code !== 'WORKSPACE_NOT_FOUND') throw err;
      this.renderer.notice({
        code: 'TOOLCHAIN_BUNDLED',
        message: 'not inside a workspace; using the bundled toolchain baseline',
        nextSteps: ['fx init <dir> --from <source>'],
      });
      return bundledToolchain(this.container.bundledTools(), this.config.version);
    }
  }

  protected async workspace(): Promise<WorkspaceContext> {
    this.located = await WorkspaceContext.locate({
      ...this.resolveInput(),
      git: this.container.git,
      localStore: this.container.localStore,
      bundledTools: this.container.bundledTools,
      providers: this.container.providers,
      cliVersion: this.config.version,
    });
    return this.located;
  }

  protected updateChecks(): UpdateChecks {
    return updateChecks(this.container);
  }

  protected skipUpdateChecks(): void {
    this.updateCheckOn = false;
  }

  protected get updateChecksOn(): boolean {
    return this.updateCheckOn && !this.quietOn;
  }

  protected async fxUpdateInput(
    options: { resolveRegistry?: boolean } = {},
  ): Promise<FxUpdateInput> {
    const pjson = this.config.pjson as { name: string };
    const location =
      options.resolveRegistry === false
        ? undefined
        : await this.container.registryLocator.resolve(pjson.name);
    return {
      current: this.config.version,
      packageName: pjson.name,
      registry: location?.registry ?? null,
      ...(location ? { registrySource: location.source } : {}),
    };
  }

  protected override async finally(err: Error | undefined): Promise<void> {
    await this.operationLease?.release();
    const gate = { id: this.id, quiet: this.quietOn, enabled: this.updateCheckOn };
    if (shouldCheckUpdates(gate)) {
      const notices = await updateNotices(
        this.updateChecks(),
        await this.fxUpdateInput(),
        this.located === undefined
          ? undefined
          : { workspace: this.located.name, sourceDir: this.located.manifestDir },
      );
      for (const notice of notices) this.renderer.notice(notice);
    }
    return super.finally(err);
  }

  protected manifestDir(): Promise<string> {
    return resolveManifestDir(this.resolveInput());
  }

  protected manifestContext(dir: string): Promise<ManifestContext> {
    return loadManifestContext({
      dir,
      fs: this.container.fs,
      bundledTools: this.container.bundledTools,
      providers: this.container.providers,
      cliVersion: this.config.version,
      reporter: this.reporter,
      diagnostics: this.container.diagnostics,
    });
  }

  protected resolveInput(): ResolveInput {
    return {
      cwd: process.cwd(),
      ...(this.selection === undefined ? {} : { selection: this.selection }),
      commandShell: this.commandShell,
      name: this.workspaceName,
      config: this.container.config,
      fs: this.container.fs,
      reporter: this.reporter,
      diagnostics: this.container.diagnostics,
      manifestDirFor: this.container.manifestDirFor,
    };
  }

  protected override async catch(err: unknown): Promise<never> {
    if (err instanceof Errors.ExitError) throw err;
    const failure = this.classify(err);
    invocation.trace?.failed(failure);
    if (failure.category === 'internal')
      this.renderer.emit({
        kind: 'cause',
        phase: 'error boundary',
        cause_chain: causeChain(failure),
      });
    if (failure.partialResult !== undefined) {
      if ('preparation' in failure.partialResult)
        await this.renderPreparation(failure.partialResult as { preparation: Preparation }, false);
      else this.renderer.record(failure.partialResult);
    }
    this.renderer.error(failure);
    return this.exit(exitCodeFor(failure.category));
  }

  private classify(err: unknown): DevkitError {
    if (err instanceof DevkitError) return err;
    // Only oclif's own parser throws its CLIError inside a command: a bad
    // flag, a missing argument, an unexpected one.
    if (err instanceof Errors.CLIError) {
      return new DevkitError('usage', 'BAD_FLAG', err.message, {
        hint: `Check \`${this.commandName} --help\` for the accepted flags and arguments.`,
        nextSteps: [`${this.commandName} --help`],
      });
    }
    return asDevkitError(err);
  }
}
