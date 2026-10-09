// A task-oriented terminal view; structured reports remain the machine interface.
// `preparation.next` instructs an agent and stays in the structured report.
import type { Preparation, PreparationAction } from '../domain/preparation.js';
import { shellEnvironmentLine, shellLine, type ResolvedShell } from '../domain/shell.js';

export function preparationText(
  value: { readonly preparation: Preparation },
  shell: ResolvedShell,
  includeEnvironment = false,
): string {
  const data = record(value);
  const preparation = value.preparation;
  const target = typeof data['root'] === 'string' ? data['root'] : preparation.scope.workspace;
  const initialization = 'manifest_dir' in data;
  const headline = {
    ready: `${initialization ? 'Ready to work' : 'Required preparation verified'}: ${target}`,
    planned: `Preparation preview; no changes made: ${target}`,
    incomplete: `${target} needs attention: ${count(preparation.blockers.length, 'required check')} not ready`,
  }[preparation.state];
  const lines = [headline];
  if (!initialization && preparation.state !== 'incomplete')
    lines.push(`Scope: ${preparation.scope.stages.join(', ')}`);
  if (preparation.state === 'planned') lines.push(...previewLines(data, shell));
  const setup = record(record(record(data['sync'])['stage_details'])['setup']);
  const verified = records(setup['items']).filter((item) =>
    ['done', 'verified'].includes(String(item['result'])),
  );
  if (verified.length)
    lines.push(
      `Setup already verified: ${verified.map((item) => String(item['title'])).join(', ')}`,
    );
  if (preparation.state === 'incomplete')
    lines.push(...attentionLines(preparation, shell, includeEnvironment));
  return lines.join('\n') + '\n';
}

// Every blocker under its own name, then what resolves them: the person's commands,
// what fx can repair, and the command that checks again.
function attentionLines(
  preparation: Preparation,
  shell: ResolvedShell,
  includeEnvironment: boolean,
): string[] {
  const command = (action: PreparationAction): string =>
    `  ${
      includeEnvironment && action.env
        ? shellEnvironmentLine(action.argv, action.env, shell)
        : shellLine(action.argv, shell)
    }`;
  const section = (title: string, actions: readonly PreparationAction[]): string[] =>
    actions.length ? ['', title, ...new Set(mergeSelections(actions).map(command))] : [];
  const width = Math.max(...preparation.blockers.map((check) => check.id.length));
  const optional = preparation.warnings.length;
  return [
    '',
    ...preparation.blockers.map((check) => `  ${check.id.padEnd(width)}  ${check.message}`),
    ...section(
      'Run in your terminal:',
      preparation.blockers.flatMap((check) =>
        (check.actions ?? []).filter((action) => action.actor === 'user'),
      ),
    ),
    ...section('fx can repair:', preparation.next_actions),
    ...section('Afterwards:', preparation.resume ? [preparation.resume] : []),
    ...(optional
      ? ['', `${count(optional, 'optional check')} also pending; --details lists them.`]
      : []),
  ];
}

const SELECTIONS = ['--env', '--tool'];

// Actions that differ only in which environments or tools they select are one command
// naming each of them; an action that selects none already covers the rest.
function mergeSelections(actions: readonly PreparationAction[]): PreparationAction[] {
  const merged = new Map<string, { action: PreparationAction; selected: string[][] | null }>();
  for (const action of actions) {
    const rest: string[] = [];
    const selected: string[][] = [];
    for (let index = 0; index < action.argv.length; index++) {
      const argument = action.argv[index]!;
      const selection = action.argv[index + 1];
      if (SELECTIONS.includes(argument) && selection !== undefined) {
        selected.push([argument, selection]);
        index++;
      } else rest.push(argument);
    }
    const key = JSON.stringify([rest, action.env ?? null]);
    const entry = merged.get(key) ?? { action: { ...action, argv: rest }, selected: [] };
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

function previewLines(data: Record<string, unknown>, shell: ResolvedShell): string[] {
  const plan = record(data['plan']);
  const resources = record(plan['resources']);
  const prepared = record(resources['preparation']);
  const repositories = records(plan['repositories'] ?? data['items']).filter(
    (item) => item['action'] !== 'skip_unpicked',
  );
  const counts = new Map<string, number>();
  for (const item of repositories) {
    const action = String(item['action']);
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  const lines = [
    `Repositories: ${repositories.length} selected${counts.size ? ` (${[...counts].map(([action, count]) => `${count} ${action}`).join(', ')})` : ''}`,
  ];
  const tools = records(resources['tools']).map((tool) => String(tool['name']));
  if (tools.length) lines.push(`Install if missing: ${tools.join(', ')}`);
  if (resources['workspace_guides'])
    lines.push('Prepare the workspace guides and selected Agent Skills.');
  for (const item of records(resources['guide_conflicts']))
    lines.push(`Replacement approval: ${String(item['path'])}; preserve a backup.`);
  const commands = [
    ...records(prepared['tool_install']).map((item) => item['vector']),
    ...records(record(prepared['skills'])['tools']).map((item) => item['vector']),
    ...records(resources['tool_checks']).map((item) => item['command']),
    ...records(resources['setup']).flatMap((item) => [
      ...(item['phase'] === 'prepare' ? [item['command']] : []),
      record(item['verify'])['command'],
    ]),
  ].filter(vector);
  for (const command of new Set(commands.map((command) => shellLine(command, shell))))
    lines.push(`Review command: ${command}`);
  if (plan['source_inspected'] === false)
    lines.push(
      'The source has not been inspected; its requirements will be validated before preparation.',
    );
  return lines;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function vector(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string')
  );
}
