// Init without a manifest prepares companion tools on this machine rather than a
// workspace. The person picks tools from the bundled catalog; fx installs the missing
// ones, has each install its Skill beside fx's own, and checks each sign-in. A tool's
// own setup asks for the service and the person's credentials, so fx starts it only
// when the person at the terminal says yes, never on --yes, and otherwise hands it over.

import { asDevkitError, DevkitError, toEnvelope, withPartialResult } from '../../domain/errors.js';
import {
  preparation,
  preparationCheck,
  type Preparation,
  type PreparationAction,
  type PreparationCheck,
} from '../../domain/preparation.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Process } from '../../ports/process.js';
import type { Prompter } from '../../ports/prompter.js';
import type { Reporter } from '../../ports/reporter.js';
import { CHECK_TIMEOUT_MS, commandVerdict } from '../login/verify.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { applyCopies, planCopies } from '../skill/fx-copies.js';
import { skillTargets, type SkillDeps } from '../skill/targets.js';
import { planTools, runTools } from '../skill/tool-skills.js';
import type { FxSkillItem, ToolSkillItem } from '../skill/types.js';
import { skillChecks } from '../sync/checks.js';
import { ToolCheck, type ToolStatus } from '../tool/check.js';
import type { ToolInstall, ToolInstallOutput } from '../tool/install.js';
import { selectTools } from '../tool/select.js';
import { bundledToolchain } from '../tool/toolchain.js';

export interface StandaloneInitDeps {
  readonly bundledTools: () => string;
  readonly cliVersion: string;
  readonly commandShell?: ResolvedShell;
  readonly fs: FileSystem;
  readonly process: Process;
  readonly prompter: Prompter;
  readonly reporter: Reporter;
  readonly toolInstall: ToolInstall;
  readonly skills: SkillDeps;
}

export interface StandaloneInitInput {
  // Catalog names, `all` among them for every catalog tool, or undefined to ask the person.
  readonly tools: readonly string[] | undefined;
  // A person can answer on this terminal.
  readonly interactive: boolean;
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly cwd: string;
}

export type SignIn = 'ready' | 'pending' | 'unknown' | 'none';

export interface ToolSetupRow {
  readonly name: string;
  readonly state: ToolStatus['state'];
  readonly installed: string | null;
  readonly install: 'present' | 'planned' | 'installed' | 'manual' | 'failed';
  readonly skill: 'planned' | 'installed' | 'failed' | 'none';
  readonly sign_in: SignIn;
  // The tool's own setup, which asks for the service and the person's credentials.
  readonly setup: readonly string[] | null;
}

export interface StandaloneInitOutput {
  readonly operation: 'preview' | 'apply';
  readonly tools: readonly ToolSetupRow[];
  readonly tool_install: readonly ToolInstallOutput[];
  readonly skills: {
    readonly fx: readonly FxSkillItem[];
    readonly tools: readonly ToolSkillItem[];
  };
  readonly preparation: Preparation;
}

interface SignInResult {
  readonly state: SignIn;
  readonly detail: string;
}

export const TOOL_SETUP_STAGES = ['tools', 'skills', 'setup'] as const;

export class StandaloneInit {
  constructor(private readonly deps: StandaloneInitDeps) {}

  async execute(input: StandaloneInitInput): Promise<StandaloneInitOutput> {
    const catalog = bundledToolchain(this.deps.bundledTools(), this.deps.cliVersion).all.filter(
      (tool) => tool.enabled,
    );
    const selected = await this.choose(catalog, input);
    if (!input.dryRun) assertWritable(input.posture, 'init');
    const installs = await this.install(selected, input);
    const statuses = await new ToolCheck(this.deps.process).execute({
      tools: selected,
      continueOnError: true,
    });
    const onPath = selected.filter((tool) => status(statuses, tool).state !== 'missing');
    const skills = await this.skills(selected, onPath, installs, input);
    const signIns = new Map<string, SignInResult>();
    for (const tool of onPath) signIns.set(tool.name, await this.signIn(tool, input));
    const rows = selected.map((tool) =>
      row(tool, status(statuses, tool), installs, skills.tools, signIns.get(tool.name)),
    );
    const checks = input.dryRun
      ? []
      : [
          ...rows.flatMap((item) =>
            toolChecks(item, {
              cwd: input.cwd,
              install: installs.find((result) => result.name === item.name),
              signIn: signIns.get(item.name),
            }),
          ),
          ...skillChecks(
            { links: [], ...skills, summary: {} },
            new Set(selected.map((tool) => tool.name)),
          ),
          ...(await this.agentCheck(input.cwd)),
        ];
    return {
      operation: input.dryRun ? 'preview' : 'apply',
      tools: rows,
      tool_install: installs,
      skills,
      preparation: preparation({
        scope: {
          workspace: null,
          stages: TOOL_SETUP_STAGES,
          repositories: [],
          tools: selected.map((tool) => tool.name),
          environments: [],
        },
        checks,
        preview: input.dryRun,
        resume: {
          id: 'check-tools',
          description: 'Check these tools again after setting them up',
          argv: ['fx', 'init', '--tools', selected.map((tool) => tool.name).join(',')],
          cwd: input.cwd,
          actor: 'agent',
          requires_approval: false,
        },
      }),
    };
  }

  private async choose(
    catalog: readonly ResolvedTool[],
    input: StandaloneInitInput,
  ): Promise<ResolvedTool[]> {
    const words =
      input.tools?.filter(Boolean) ??
      (input.interactive ? parseChoice(await this.deps.prompter.ask(menu(catalog)), catalog) : []);
    if (words.length === 0)
      throw new DevkitError('usage', 'INIT_INPUT_REQUIRED', 'Choose the tools to set up', {
        hint: 'Without a manifest, init sets up the companion tools you name from the catalog; with one, it prepares a workspace.',
        nextSteps: [
          this.command('fx', 'tool', 'list', '--catalog'),
          this.command('fx', 'init', '--tools', '<name,...>'),
          this.command('fx', 'init', '--tools', ALL),
          this.command('fx', 'init', '<directory>', '--from', '<source>'),
        ],
      });
    if (words.includes(ALL)) return [...catalog];
    const names = new Set(selectTools(catalog, words).map((tool) => tool.name));
    return catalog.filter((tool) => names.has(tool.name));
  }

  // One tool's failure leaves the others to install; an interruption stops them all.
  private async install(
    selected: readonly ResolvedTool[],
    input: StandaloneInitInput,
  ): Promise<ToolInstallOutput[]> {
    const results: ToolInstallOutput[] = [];
    for (const tool of selected) {
      if ((await this.deps.process.which(tool.binary)) !== undefined) continue;
      try {
        results.push(
          ...(await this.deps.toolInstall.execute({
            tools: selected,
            names: [tool.name],
            update: false,
            operation: 'init',
            dryRun: input.dryRun,
            posture: input.posture,
            commandShell: this.deps.commandShell,
          })),
        );
      } catch (error) {
        const failure = asDevkitError(error);
        if (failure.category === 'internal')
          throw withPartialResult(error, { tool_install: results });
        results.push({
          name: tool.name,
          via: tool.install[0]?.via ?? 'manual',
          vector: null,
          docs: tool.docs ?? null,
          ran: false,
          code: null,
          version_after: null,
          status: 'failed',
          error: failure.message,
          failure: toEnvelope(failure).error,
        });
      }
    }
    return results;
  }

  // Each chosen tool is installed by this init, which is what lets a preview plan the
  // Skill of a tool it has yet to install.
  private async skills(
    selected: readonly ResolvedTool[],
    onPath: readonly ResolvedTool[],
    installs: readonly ToolInstallOutput[],
    input: StandaloneInitInput,
  ): Promise<StandaloneInitOutput['skills']> {
    const failed = new Set(installs.filter((item) => item.status === 'failed').map((i) => i.name));
    const toolchain = selected
      .filter((tool) => (input.dryRun ? !failed.has(tool.name) : onPath.includes(tool)))
      .map((tool) => ({ ...tool, installOnInit: true }));
    const status = input.dryRun ? 'planned' : 'not_started';
    const fx: FxSkillItem[] = (await planCopies(this.deps, this.deps.skills, undefined)).map(
      (item) => ({ ...item, status }),
    );
    const tools: ToolSkillItem[] = (
      await planTools(this.deps, this.deps.skills, {
        toolchain,
        dryRun: input.dryRun,
        posture: input.posture,
      })
    ).map((item) => ({ ...item, status }));
    if (input.dryRun) return { fx, tools };
    try {
      await applyCopies(this.deps, this.deps.skills, fx, input);
      await runTools(this.deps, tools);
    } catch (error) {
      throw withPartialResult(error, { tool_install: installs, skills: { fx, tools } });
    }
    return { fx, tools };
  }

  private async signIn(tool: ResolvedTool, input: StandaloneInitInput): Promise<SignInResult> {
    if (tool.auth === undefined) return { state: 'none', detail: 'needs no sign-in' };
    const before = await this.check(tool);
    const login = tool.auth.login;
    const offered = input.interactive && !input.yes && !input.dryRun && login !== undefined;
    if (before.state !== 'pending' || !offered) return before;
    const vector = [tool.binary, ...login];
    const go = await this.deps.prompter.confirm(
      `${tool.name} is not signed in. Set it up now with \`${shellLine(vector, this.deps.commandShell)}\`? It asks for the service and your credentials.`,
      { defaultYes: true },
    );
    if (!go) return before;
    await this.deps.process.run(vector, {
      interactive: true,
      diagnostic: { phase: `${tool.name} setup` },
    });
    return this.check(tool);
  }

  private async check(tool: ResolvedTool): Promise<SignInResult> {
    const { command, json } = tool.auth!;
    try {
      const result = await this.deps.process.run([tool.binary, ...command], {
        timeoutMs: CHECK_TIMEOUT_MS,
        sensitiveOutput: true,
        diagnostic: { phase: `${tool.name} sign-in check` },
      });
      if (result.notStarted) return { state: 'unknown', detail: `${tool.binary} did not start` };
      const unmet = `${tool.name} is not signed in`;
      const verdict = commandVerdict(
        { command, ...(json === undefined ? {} : { json: { ...json, unmet } }) },
        result,
      );
      if (verdict.ok) return { state: 'ready', detail: `${tool.name} is signed in` };
      const said = verdict.detail === unmet ? '' : `: ${verdict.detail}`;
      return { state: 'pending', detail: `${unmet}${said}` };
    } catch (error) {
      const failure = asDevkitError(error);
      if (failure.code !== 'PROCESS_TIMEOUT') throw error;
      return { state: 'unknown', detail: failure.message };
    }
  }

  // Skills reach the coding agents fx finds, or the ones a person picked with `fx agent pick`.
  private async agentCheck(cwd: string): Promise<PreparationCheck[]> {
    if ((await skillTargets(this.deps.skills, undefined)).length > 0) return [];
    return [
      preparationCheck('skill:agents', 'blocked', 'No coding agent found; no Skill was installed', {
        required: false,
        owner: 'user',
        actions: [
          {
            id: 'agents',
            description: 'List the coding agents fx knows; fx agent pick chooses where Skills go',
            argv: ['fx', 'agent', 'list'],
            cwd,
            actor: 'agent',
            requires_approval: false,
          },
        ],
      }),
    ];
  }

  private command(...vector: readonly string[]): string {
    return shellLine(vector, this.deps.commandShell);
  }
}

const ALL = 'all';

function menu(catalog: readonly ResolvedTool[]): string {
  const width = Math.max(...catalog.map((tool) => tool.name.length));
  const lines = catalog.map((tool, index) =>
    `${String(index + 1).padStart(3)}  ${tool.name.padEnd(width)}  ${tool.desc ?? ''}`.trimEnd(),
  );
  return [
    'No manifest given, so fx sets up companion tools on this machine.',
    'For a workspace from a manifest, run fx init <directory> --from <source> instead.',
    '',
    ...lines,
    'Which ones? Numbers or names, separated by commas or spaces (Enter for all):',
  ].join('\n');
}

// A number is the tool listed at that position; anything else is a name, checked later.
function parseChoice(answer: string, catalog: readonly ResolvedTool[]): readonly string[] {
  const words = answer.split(/[\s,]+/).filter(Boolean);
  if (words.length === 0) return [ALL];
  return words.map((word) => {
    const index = /^\d+$/.test(word) ? Number(word) - 1 : -1;
    return catalog[index]?.name ?? word;
  });
}

function status(statuses: readonly ToolStatus[], tool: ResolvedTool): ToolStatus {
  return statuses.find((item) => item.name === tool.name)!;
}

function row(
  tool: ResolvedTool,
  current: ToolStatus,
  installs: readonly ToolInstallOutput[],
  skills: readonly ToolSkillItem[],
  signIn: SignInResult | undefined,
): ToolSetupRow {
  const installed = installs.find((item) => item.name === tool.name);
  const own = skills.filter((item) => item.tool === tool.name && item.vector !== null);
  return {
    name: tool.name,
    state: current.state,
    installed: current.installed,
    install: installOutcome(installed),
    skill: skillOutcome(own, installed),
    sign_in: signIn?.state ?? 'unknown',
    setup: tool.auth?.login === undefined ? null : [tool.binary, ...tool.auth.login],
  };
}

function installOutcome(installed: ToolInstallOutput | undefined): ToolSetupRow['install'] {
  if (installed === undefined) return 'present';
  if (installed.status === 'planned') return 'planned';
  if (installed.status === 'failed') return 'failed';
  return installed.ran ? 'installed' : 'manual';
}

function skillOutcome(
  own: readonly ToolSkillItem[],
  installed: ToolInstallOutput | undefined,
): ToolSetupRow['skill'] {
  if (own.length === 0) return 'none';
  if (own.some((item) => item.status === 'failed' || item.failure !== undefined)) return 'failed';
  if (own.every((item) => item.status === 'planned') || installed?.status === 'planned')
    return 'planned';
  return 'installed';
}

// A tool that is not on PATH has nothing to sign in to yet; its installation is the blocker.
function toolChecks(
  item: ToolSetupRow,
  context: {
    readonly cwd: string;
    readonly install: ToolInstallOutput | undefined;
    readonly signIn: SignInResult | undefined;
  },
): PreparationCheck[] {
  const { signIn, cwd } = context;
  const checks = [installCheck(item, context)];
  if (signIn === undefined || signIn.state === 'none') return checks;
  const ready = signIn.state === 'ready';
  const state = signIn.state === 'pending' ? 'blocked' : signIn.state;
  checks.push(
    preparationCheck(`login:${item.name}.auth`, state, signIn.detail, {
      resource: item.name,
      owner: 'user',
      ...(ready || item.setup === null
        ? {}
        : {
            actions: [
              {
                id: `setup:${item.name}`,
                description: `Set up ${item.name}: it asks for the service and your credentials`,
                argv: item.setup,
                cwd,
                actor: 'user',
                requires_approval: false,
              },
            ],
          }),
    }),
  );
  return checks;
}

function installCheck(
  item: ToolSetupRow,
  context: { readonly cwd: string; readonly install: ToolInstallOutput | undefined },
): PreparationCheck {
  const id = `tool:${item.name}`;
  const action = (
    command: 'show' | 'update',
    description: string,
    approval = false,
  ): PreparationAction => ({
    id,
    description,
    argv: ['fx', 'tool', command, item.name],
    cwd: context.cwd,
    actor: 'agent',
    requires_approval: approval,
  });
  const common = { resource: item.name, owner: 'user' as const };
  if (item.state === 'ok') return preparationCheck(id, 'ready', `${item.name} ${item.installed}`);
  if (item.state === 'outdated')
    return preparationCheck(
      id,
      'blocked',
      `${item.name} ${item.installed} is older than fx needs`,
      {
        ...common,
        actions: [action('update', `Update ${item.name}`, true)],
      },
    );
  if (item.state === 'unknown')
    return preparationCheck(id, 'unknown', `${item.name} did not report its version`, {
      ...common,
      actions: [action('show', `Inspect ${item.name}`)],
    });
  const failure = context.install?.failure;
  const said = context.install?.error;
  return preparationCheck(
    id,
    'blocked',
    item.install === 'manual'
      ? `${item.name} has to be installed by hand`
      : `${item.name} is not installed${said ? `: ${said}` : ''}`,
    {
      ...common,
      ...(failure === undefined ? {} : { code: failure.code, failure }),
      actions: [action('show', `See how to install ${item.name}`)],
    },
  );
}
