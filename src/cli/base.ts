// The command base. It resolves the global flags in a lenient pre-parse so
// the renderer and posture exist before the command's own strict parse, and
// it is the single error boundary: whatever escapes a command leaves through
// the renderer's error contract on stderr and a category exit code.

import { Command, Errors } from '@oclif/core';

import { readSettings } from '../application/config/settings.js';
import type { StandaloneInitDeps } from '../application/init/standalone.js';
import type { InitDeps } from '../application/init/types.js';
import type { LoginDeps } from '../application/login/deps.js';
import type { ManifestContext } from '../application/manifest/context.js';
import { resolveManifestDir } from '../application/manifest/locate.js';
import { resolvePosture, type WritePosture } from '../application/safety/posture.js';
import type { TrustContext } from '../application/safety/trust.js';
import type { SkillDeps } from '../application/skill/targets.js';
import type { SyncStageDeps } from '../application/sync/stages.js';
import type { Toolchain } from '../application/tool/toolchain.js';
import type { FxUpdateInput } from '../application/update/fx.js';
import { beginWorkspaceCommand } from '../application/workspace/command-operation.js';
import type { WorkspaceContext } from '../application/workspace/context.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import type { ResolveInput } from '../application/workspace/resolve.js';
import { fxExecutable } from '../composition/bundled.js';
import {
  CommandWiring,
  resolveInputFor,
  type LifecycleSessions,
} from '../composition/command-wiring.js';
import { createContainer, type Container } from '../composition/container.js';
import type { HarnessCommandInput } from '../composition/harness.js';
import type { UpdateChecks } from '../composition/update.js';
import { causeChain } from '../domain/diagnostics.js';
import { asDevkitError, DevkitError, exitCodeFor } from '../domain/errors.js';
import { DEFAULT_FORMAT, isFormat, type Format } from '../domain/format.js';
import type { Preparation, PreparationAction, PreparationCheck } from '../domain/preparation.js';
import { resolveCommandShell, type ResolvedShell } from '../domain/shell.js';
import type { Lease } from '../ports/lock.js';
import type { ReplaceFiles } from '../ports/replace-files.js';

import { compatibilityTarget } from './commands/aliases.js';
import { globalFlags } from './flags.js';
import { invocationFormat, UNDECIDED_FORMAT } from './invocation-format.js';
import { preparationText, type PreparationReport } from './preparation-view.js';
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
import { writeScopeOf, type WriteScopeDeclaration } from './workspace-write-policy.js';

export abstract class FxCommand extends Command {
  static baseFlags = globalFlags;
  declare static writeScope?: WriteScopeDeclaration;
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
  private commandWiring: CommandWiring | undefined;
  private operationLease: Lease | undefined;
  private selection: ResolveInput['selection'];

  protected get commandName(): string {
    return `fx ${this.commandWords}`.trim();
  }

  private get commandWords(): string {
    return (this.id ?? '').replaceAll(':', ' ');
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
      // A compatibility name reports like the command it stands for.
      report: reportCommand(compatibilityTarget(this.id ?? '') ?? this.id),
      details: flags['details'] === true,
      fields: parseFields(flags.fields),
      quiet: flags.quiet,
      verbose: flags.verbose,
      noHeader: flags['no-header'],
      shell: this.commandShell,
    };
    this.renderer = createRenderer(this.format, processIo(), this.renderOptions);
    this.container.diagnostics.connect(this.renderer);
    this.showWork();
    this.noInput = flags['no-input'] || !process.stdin.isTTY;
    this.quietOn = flags.quiet;
    this.yes = flags.yes;
    this.workspaceName = flags.workspace;
    this.posture = resolvePosture({ allowWrites: flags['allow-writes'], env: process.env, file });
    const scope = writeScopeOf(spec, flags);
    if (scope !== null && !this.posture.readOnly) {
      const operation = await beginWorkspaceCommand(
        this.resolveInput(),
        this.container.lock,
        scope,
      );
      if (operation) {
        this.operationLease = operation.lease;
        this.workspaceName = operation.located.name;
        this.selection = operation.located.selection;
      }
    }
  }

  // From here until the command ends, a person watching stderr sees that fx is at work.
  // It starts before the workspace lease: waiting for another fx is work too.
  private showWork(): void {
    const { status } = this.renderer;
    if (status === undefined) return;
    this.container.activity.connect(status);
    status.start(this.commandWords);
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

  // The preparation view closes with what each stage did, so a terminal leaves every
  // success and the partial-sync notice to it; --verbose and --details still show each row.
  protected foldRestatedOutcomes(): void {
    if (this.renderOptions.verbose || this.renderOptions.details) return;
    this.renderer.status?.fold({ outcomes: ['done'], notices: ['SYNC_PARTIAL'] });
  }

  protected async renderPreparation(
    value: PreparationReport,
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
        bound.scope.workspace === null
          ? 'Required tool setup is unfinished'
          : 'Required workspace preparation is unfinished',
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
      env: this.wiring().recoveryEnv(),
    };
  }

  protected async workspaceDeps(): Promise<WorkspaceDeps> {
    return this.wiring().workspaceDeps(await this.workspace());
  }

  // For a command that reaches a workspace's toolchain without its dependency bundle.
  protected trustFor(workspace: string): TrustContext {
    return this.wiring().trustFor(workspace);
  }

  protected harnessInput(): HarnessCommandInput {
    return this.wiring().harnessInput();
  }

  // Built on first use, after init has settled the invocation it describes.
  private wiring(): CommandWiring {
    this.commandWiring ??= new CommandWiring({
      container: this.container,
      resolve: this.resolveInput(),
      env: process.env,
      cliVersion: this.config.version,
      noInput: this.noInput,
      yes: this.yes,
      posture: this.posture,
      commandShell: this.commandShell,
      reporter: this.reporter,
      agents: this.configAgentList,
      user: this.configUser,
    });
    return this.commandWiring;
  }

  protected lifecycleSessions(): LifecycleSessions {
    return this.wiring().lifecycleSessions();
  }
  protected loginDeps(): LoginDeps {
    return this.wiring().loginDeps();
  }
  protected initDeps(): InitDeps {
    return this.wiring().initDeps();
  }
  protected standaloneInitDeps(): StandaloneInitDeps {
    return this.wiring().standaloneInitDeps();
  }
  protected stageDeps(): SyncStageDeps {
    return this.wiring().stageDeps();
  }
  protected skillDeps(): SkillDeps {
    return this.wiring().skillDeps();
  }
  protected replacement(): ReplaceFiles {
    return this.wiring().replacement();
  }

  protected toolchain(): Promise<Toolchain> {
    return this.wiring().toolchain(() => this.workspace());
  }

  protected async workspace(): Promise<WorkspaceContext> {
    this.located = await this.wiring().locateWorkspace();
    return this.located;
  }

  protected updateChecks(): UpdateChecks {
    return this.wiring().updateChecks();
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
    const { name } = this.config.pjson as { name: string };
    return this.wiring().fxUpdateInput(name, options.resolveRegistry !== false);
  }

  protected override async finally(err: Error | undefined): Promise<void> {
    try {
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
    } finally {
      this.renderer.status?.stop();
    }
    return super.finally(err);
  }

  protected manifestDir(): Promise<string> {
    return resolveManifestDir(this.resolveInput());
  }

  protected manifestContext(dir: string): Promise<ManifestContext> {
    return this.wiring().manifestContext(dir);
  }

  protected resolveInput(): ResolveInput {
    return resolveInputFor(this.container, {
      cwd: process.cwd(),
      selection: this.selection,
      name: this.workspaceName,
      commandShell: this.commandShell,
      reporter: this.reporter,
    });
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
        await this.renderPreparation(failure.partialResult as PreparationReport, false);
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
