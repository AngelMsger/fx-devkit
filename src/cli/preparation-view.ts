// A task-oriented terminal view; structured reports remain the machine interface.
// `preparation.next` instructs an agent and stays in the structured report.
import type { StandaloneInitOutput, ToolSetupRow } from '../application/init/standalone.js';
import type { InitOutput } from '../application/init/types.js';
import { isSettled } from '../application/login/run.js';
import type { StageSummary } from '../application/preparation.js';
import type { SyncItem, SyncOutput } from '../application/sync/types.js';
import type { Preparation, PreparationAction, PreparationCheck } from '../domain/preparation.js';
import type { CheckCause } from '../domain/setup/types.js';
import { shellEnvironmentLine, shellLine, type ResolvedShell } from '../domain/shell.js';

import type { Display, Mark } from './render/display.js';
import { roleOf } from './render/tone.js';
import { gap, widthOf } from './render/width.js';

// Every preparation report carries a verdict. An initialization also names its root,
// its plan and its first sync; a sync lists the repositories it reconciles; an
// initialization without a manifest lists the tools it set up on this machine.
export type PreparationReport = { readonly preparation: Preparation } & Partial<
  Pick<InitOutput, 'root' | 'manifest_dir' | 'plan' | 'sync' | 'tool_install'> &
    Pick<SyncOutput, 'items' | 'stages'> &
    Pick<StandaloneInitOutput, 'tools' | 'skills'>
>;

export interface PreparationView {
  readonly shell: ResolvedShell;
  readonly display: Display;
  // Print the coordinates a command needs when FX_HOME is not the default.
  readonly includeEnvironment?: boolean;
}

// Below this a wrapped reason is a column of fragments; the terminal may wrap it instead.
const NARROWEST_REASON = 24;

// More names than this say less than their number does.
const NAMES_SHOWN = 4;

// What each cause asks of the person, in the order a person can act on them.
const CAUSES: readonly (readonly [CheckCause | undefined, string])[] = [
  ['credential', 'Sign-in or credentials:'],
  ['permission', 'Access refused:'],
  ['network', 'Not reachable from this machine:'],
  [undefined, 'Other:'],
];

// Codes that say no more than the message they come with.
const GENERIC_CODES = new Set(['PREPARATION_REQUIRED', 'SETUP_COMMAND_FAILED']);

const STAGE_LABELS: Readonly<Record<string, string>> = {
  services: 'Services',
  setup: 'Logins',
  docs: 'Guides',
  go: 'Go workspace',
  skills: 'Skills',
  hooks: 'Hooks',
  mcp: 'MCP',
  tools: 'Tools',
};

const VERDICT: Readonly<Record<Preparation['state'], Mark | undefined>> = {
  ready: 'ok',
  planned: undefined,
  incomplete: 'fail',
};

export function preparationText(report: PreparationReport, view: PreparationView): string {
  const { display } = view;
  const { preparation } = report;
  const target = report.root ?? preparation.scope.workspace ?? 'this machine';
  const initialization = report.manifest_dir !== undefined || report.tools !== undefined;
  const groups = blockerRows(preparation.blockers).length;
  const grouping = groups < preparation.blockers.length ? `, in ${groups} groups` : '';
  const headline = {
    ready: `${initialization ? 'Ready to work' : 'Required preparation verified'}: ${target}`,
    planned: `Preparation preview; no changes made: ${target}`,
    incomplete: `${target} needs attention: ${count(preparation.blockers.length, 'required check')} not ready${grouping}`,
  }[preparation.state];
  const verdict = VERDICT[preparation.state];
  const lines = [
    `${verdict === undefined ? '' : display.mark(verdict)}${display.paint('strong', headline)}`,
  ];
  if (!initialization && preparation.state !== 'incomplete')
    lines.push(display.paint('quiet', `Scope: ${preparation.scope.stages.join(', ')}`));
  if (report.tools !== undefined) lines.push(...toolSetupLines(report, view));
  else if (preparation.state !== 'planned') lines.push(...stageLines(report, display));
  else lines.push(...previewLines(report, view));
  const setup = report.sync?.stage_details?.setup;
  const steps = setup === undefined || 'failure' in setup ? [] : setup.items;
  const verified = steps.filter((step) => isSettled(step.result));
  if (verified.length)
    lines.push(`Setup already verified: ${verified.map((step) => step.title).join(', ')}`);
  if (preparation.state === 'incomplete') lines.push(...attentionLines(preparation, view));
  return lines.join('\n') + '\n';
}

// Every blocker under its own name, then what resolves them: the person's commands,
// what fx can repair, and the command that checks again.
function attentionLines(preparation: Preparation, view: PreparationView): string[] {
  const { display, shell } = view;
  const command = (action: PreparationAction): string =>
    `  ${display.paint(
      'accent',
      view.includeEnvironment && action.env
        ? shellEnvironmentLine(action.argv, action.env, shell)
        : shellLine(action.argv, shell),
    )}`;
  const section = (title: string, actions: readonly PreparationAction[]): string[] =>
    actions.length
      ? ['', display.paint('strong', title), ...new Set(mergeSelections(actions).map(command))]
      : [];
  const optional = preparation.warnings.length;
  return [
    '',
    ...blockerLines(preparation.blockers, display),
    ...section(
      'Run in your terminal:',
      preparation.blockers.flatMap((check) =>
        (check.actions ?? []).filter((action) => action.actor === 'user'),
      ),
    ),
    ...section('fx can repair:', preparation.next_actions),
    ...section('Afterwards:', preparation.resume ? [preparation.resume] : []),
    ...(optional
      ? [
          '',
          display.paint(
            'quiet',
            `${count(optional, 'optional check')} also pending; --details lists them.`,
          ),
        ]
      : []),
  ];
}

interface BlockerRow {
  readonly check: PreparationCheck;
  readonly label: string;
  // The listed checks that wait, directly or through another, on this row's checks and
  // were not checked themselves.
  readonly holding: readonly string[];
}

// Checks that say the same thing and are resolved by the same commands share a row, and a
// check waiting on a listed one is named under the row its chain of waits leads to rather
// than as a row of its own.
function blockerRows(blockers: readonly PreparationCheck[]): BlockerRow[] {
  const listed = new Map(blockers.map((check) => [check.id, check]));
  const waits = (check: PreparationCheck): boolean =>
    check.waits_on !== undefined && listed.has(check.waits_on);
  const origin = (check: PreparationCheck): string => {
    const seen = new Set<string>();
    let current = check;
    while (waits(current) && !seen.has(current.id)) {
      seen.add(current.id);
      current = listed.get(current.waits_on!)!;
    }
    return current.id;
  };
  const rows = new Map<string, { check: PreparationCheck; ids: string[] }>();
  for (const check of blockers.filter((check) => !waits(check))) {
    const resolution = (check.actions ?? []).map((action) => selections(action.argv).command);
    const key = JSON.stringify([check.state, check.message, resolution]);
    const row = rows.get(key) ?? { check, ids: [] };
    row.ids.push(check.id);
    rows.set(key, row);
  }
  return [...rows.values()].map(({ check, ids }) => ({
    check,
    label: ids.length > 1 ? `${check.id} (+${ids.length - 1} more)` : check.id,
    holding: blockers
      .filter((other) => waits(other) && ids.includes(origin(other)))
      .map((other) => other.id),
  }));
}

// Grouped by what the person is to do once any check says why it failed; a check that
// could not run is marked apart from one that ran and failed. A reason too long for the
// line continues under its own column, not under the check id.
function blockerLines(blockers: readonly PreparationCheck[], display: Display): string[] {
  const rows = blockerRows(blockers);
  const width = Math.max(...rows.map((row) => widthOf(row.label)));
  const lead = 2 + widthOf(display.mark()) + width + 2;
  const room = Math.max(display.room(lead), NARROWEST_REASON);
  const line = ({ check, label, holding }: BlockerRow): string[] => {
    const [first = '', ...rest] = display.wrap(reasonOf(check), room);
    const mark = display.mark(check.state === 'unknown' ? 'step' : 'fail');
    const quiet = (text: string): string[] =>
      display.wrap(text, room).map((part) => display.paint('quiet', part));
    const held = holding.length ? quiet(`holds back ${holding.join(', ')}`) : [];
    return [
      `  ${mark}${display.paint('strong', label)}${gap(label, width)}  ${first}`,
      ...[...rest, ...adviceOf(check).flatMap(quiet), ...held].map(
        (text) => `${' '.repeat(lead)}${text}`,
      ),
    ];
  };
  if (!rows.some((row) => row.check.cause !== undefined)) return rows.flatMap(line);
  return CAUSES.flatMap(([cause, title]) => {
    const group = rows.filter((row) => row.check.cause === cause);
    return group.length ? [display.paint('strong', title), ...group.flatMap(line)] : [];
  });
}

// A check no fx command resolves keeps the recovery its own failure advises, which would
// otherwise reach only a machine reader.
function adviceOf(check: PreparationCheck): readonly string[] {
  if (check.actions?.length || check.failure === undefined) return [];
  if (GENERIC_CODES.has(check.failure.code)) return [];
  const { hint, next_steps } = check.failure;
  return [...(hint ? [hint] : []), ...next_steps];
}

function reasonOf(check: PreparationCheck): string {
  const said = check.failure !== undefined && !GENERIC_CODES.has(check.code);
  return said && !check.message.includes(check.code)
    ? `${check.message} (${check.code})`
    : check.message;
}

// What each stage did, one line each: repositories by what became of them, the manifest
// checkout by what its refresh did, any other stage by the counts that say something
// happened. A stage with nothing to say is left out.
function stageLines(report: PreparationReport, display: Display): string[] {
  const sync: Partial<Pick<SyncOutput, 'items' | 'stages'>> =
    (report.manifest_dir === undefined ? report : report.sync) ?? {};
  const items = (sync.items ?? []).filter((item) => item.action !== 'skip_unpicked');
  const rows: [string, string][] = [];
  const repositories = items.filter((item) => item.action !== 'skip_manifest');
  if (repositories.length) rows.push(['Repositories', repositoryLine(repositories)]);
  const manifest = items.find((item) => item.action === 'skip_manifest');
  if (manifest?.reason !== undefined) rows.push(['Manifest', manifest.reason]);
  for (const [stage, summary] of Object.entries(sync.stages ?? {})) {
    const said = stageSummary(summary);
    if (said !== undefined) rows.push([STAGE_LABELS[stage] ?? stage, said]);
  }
  const width = Math.max(0, ...rows.map(([label]) => widthOf(label)));
  return rows.map(
    ([label, text]) => `${display.paint('quiet', label)}${gap(label, width)}  ${text}`,
  );
}

function repositoryLine(items: readonly SyncItem[]): string {
  const outcome = (value: string): number => items.filter((item) => item.outcome === value).length;
  const named = (result: SyncItem['result']): string[] =>
    items.filter((item) => item.result === result).map((item) => item.name);
  const cloned = items.filter((item) => item.action === 'clone' && item.result === 'done');
  const parts = [
    cloned.length ? `${cloned.length} cloned` : '',
    outcome('updated') ? `${outcome('updated')} updated` : '',
    outcome('up_to_date') ? `${outcome('up_to_date')} up to date` : '',
    names(named('skipped'), 'skipped'),
    names(named('failed'), 'failed'),
  ].filter(Boolean);
  return `${items.length}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

function names(list: readonly string[], what: string): string {
  if (list.length === 0) return '';
  const shown = list.slice(0, NAMES_SHOWN).join(', ');
  const more = list.length > NAMES_SHOWN ? ` (+${list.length - NAMES_SHOWN} more)` : '';
  return `${list.length} ${what} (${shown}${more})`;
}

// A count of zero, or of what tone reads as nothing happening, says nothing.
function stageSummary(summary: StageSummary | 'not_implemented'): string | undefined {
  if (summary === 'not_implemented') return 'not available in this version';
  if (summary['status'] === 'failed') return 'failed';
  const said = Object.entries(summary).flatMap(([key, value]) => {
    if (typeof value === 'number')
      return value > 0 && roleOf(key) !== 'quiet' ? [`${value} ${key.replaceAll('_', ' ')}`] : [];
    return roleOf(value) !== 'quiet' ? [`${key.replaceAll('_', ' ')} ${value}`] : [];
  });
  return said.length ? said.join(', ') : undefined;
}

const SELECTIONS = ['--env', '--tool'];

// A command apart from the environments or tools it selects.
function selections(argv: readonly string[]): { command: string[]; selected: string[][] } {
  const command: string[] = [];
  const selected: string[][] = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const selection = argv[index + 1];
    if (SELECTIONS.includes(argument) && selection !== undefined) {
      selected.push([argument, selection]);
      index++;
    } else command.push(argument);
  }
  return { command, selected };
}

// Actions that differ only in which environments or tools they select are one command
// naming each of them; an action that selects none already covers the rest.
function mergeSelections(actions: readonly PreparationAction[]): PreparationAction[] {
  const merged = new Map<string, { action: PreparationAction; selected: string[][] | null }>();
  for (const action of actions) {
    const { command, selected } = selections(action.argv);
    const key = JSON.stringify([command, action.env ?? null]);
    const entry = merged.get(key) ?? { action: { ...action, argv: command }, selected: [] };
    if (selected.length === 0 || entry.selected === null) entry.selected = null;
    else
      for (const pair of selected)
        if (!entry.selected.some((known) => known.join() === pair.join()))
          entry.selected.push(pair);
    merged.set(key, entry);
  }
  return [...merged.values()].map(({ action, selected }) => ({
    ...action,
    argv: [...action.argv, ...(selected ?? []).flat()],
  }));
}

function count(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? ' is' : 's are'}`;
}

function previewLines(report: PreparationReport, view: PreparationView): string[] {
  const { display, shell } = view;
  const { plan } = report;
  const resources = plan?.resources;
  const prepared = resources?.preparation;
  const repositories = (plan?.repositories ?? report.items ?? []).filter(
    (item) => item.action !== 'skip_unpicked',
  );
  const counts = new Map<string, number>();
  for (const { action } of repositories) counts.set(action, (counts.get(action) ?? 0) + 1);
  const lines = [
    `Repositories: ${repositories.length} selected${counts.size ? ` (${[...counts].map(([action, count]) => `${count} ${action}`).join(', ')})` : ''}`,
  ];
  const tools = (resources?.tools ?? []).map((tool) => tool.name);
  if (tools.length) lines.push(`Install if missing: ${tools.join(', ')}`);
  if (resources?.workspace_guides)
    lines.push('Prepare the workspace guides and selected Agent Skills.');
  for (const conflict of resources?.guide_conflicts ?? [])
    lines.push(`Replacement approval: ${conflict.path}; preserve a backup.`);
  const commands = [
    ...(prepared?.tool_install ?? []).map((install) => install.vector),
    ...(prepared?.skills.tools ?? []).map((skill) => skill.vector),
    ...(resources?.tool_checks ?? []).map((check) => check.command),
    ...(resources?.setup ?? []).flatMap((step) => [
      ...(step.phase === 'prepare' ? [step.command] : []),
      'command' in step.verify ? step.verify.command : null,
    ]),
  ].filter(isVector);
  for (const command of new Set(commands.map((command) => shellLine(command, shell))))
    lines.push(`Review command: ${display.paint('accent', command)}`);
  if (plan?.source_inspected === false)
    lines.push(
      'The source has not been inspected; its requirements will be validated before preparation.',
    );
  return lines;
}

// One line per tool set up without a manifest: what it is now, its Skill and its sign-in.
// A preview adds every command it would run.
function toolSetupLines(report: PreparationReport, view: PreparationView): string[] {
  const { display, shell } = view;
  const rows = (report.tools ?? []).map((tool): [ToolSetupRow, string[]] => [
    tool,
    [tool.name, installText(tool), SKILL_TEXT[tool.skill], SIGN_IN_TEXT[tool.sign_in]],
  ]);
  const widths = [0, 1, 2].map((column) =>
    Math.max(0, ...rows.map(([, cells]) => widthOf(cells[column]!))),
  );
  const lines = rows.map(([tool, cells]) => {
    const text = cells
      .map((cell, column) => (column < 3 ? `${cell}${gap(cell, widths[column]!)}` : cell))
      .join('  ')
      .trimEnd();
    return `${display.mark(toolMark(tool, report.preparation.state))}${text}`;
  });
  if (report.preparation.state !== 'planned') return lines;
  const commands = [
    ...(report.tool_install ?? []).map((install) => install.vector),
    ...(report.skills?.tools ?? []).map((skill) => skill.vector),
  ].filter(isVector);
  for (const command of new Set(commands.map((command) => shellLine(command, shell))))
    lines.push(`Review command: ${display.paint('accent', command)}`);
  return lines;
}

function installText(tool: ToolSetupRow): string {
  if (tool.install === 'planned') return 'to install';
  if (tool.install === 'manual') return 'install by hand';
  if (tool.install === 'failed') return 'not installed';
  const version = tool.installed ?? 'version unknown';
  const outdated = tool.state === 'outdated' ? ', older than needed' : '';
  return `${tool.install === 'installed' ? 'installed ' : ''}${version}${outdated}`;
}

const SKILL_TEXT: Readonly<Record<ToolSetupRow['skill'], string>> = {
  planned: 'Skill to install',
  installed: 'Skill installed',
  failed: 'Skill failed',
  none: '',
};

const SIGN_IN_TEXT: Readonly<Record<ToolSetupRow['sign_in'], string>> = {
  ready: 'signed in',
  pending: 'not signed in',
  unknown: 'sign-in not checked',
  none: '',
};

function toolMark(tool: ToolSetupRow, state: Preparation['state']): Mark | undefined {
  if (state === 'planned') return undefined;
  const ready =
    tool.state === 'ok' && tool.skill !== 'failed' && ['ready', 'none'].includes(tool.sign_in);
  return ready ? 'ok' : 'fail';
}

function isVector(command: readonly string[] | null): command is readonly string[] {
  return command !== null && command.length > 0;
}
