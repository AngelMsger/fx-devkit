// A task-oriented terminal view; structured reports remain the machine interface.
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
    ready: initialization ? 'Ready to work' : 'Required preparation verified',
    planned: 'Preparation preview; no changes made',
    incomplete: 'Preparation needs attention; completed work is preserved',
  }[preparation.state];
  const lines = [`${headline}: ${target}`];
  if (!initialization) lines.push(`Scope: ${preparation.scope.stages.join(', ')}`);
  if (preparation.state === 'planned') lines.push(...previewLines(data, shell));
  else lines.push(preparation.next.message);
  const setup = record(record(record(data['sync'])['stage_details'])['setup']);
  const verified = records(setup['items']).filter((item) =>
    ['done', 'verified'].includes(String(item['result'])),
  );
  if (verified.length)
    lines.push(
      `Setup already verified: ${verified.map((item) => String(item['title'])).join(', ')}`,
    );
  lines.push(...preparation.blockers.map((check) => `- ${check.message}`));
  const command = (action: PreparationAction): string =>
    includeEnvironment && action.env
      ? shellEnvironmentLine(action.argv, action.env, shell)
      : shellLine(action.argv, shell);
  const userActions = preparation.blockers.flatMap((check) =>
    (check.actions ?? []).filter((action) => action.actor === 'user'),
  );
  const shown = new Set<string>();
  for (const action of userActions) {
    const line = command(action);
    if (shown.has(line)) continue;
    shown.add(line);
    lines.push(`Your next step: ${action.description}`, `Run in your terminal: ${line}`);
  }
  for (const action of preparation.next_actions) lines.push(`Next: ${command(action)}`);
  if (preparation.resume)
    lines.push(`After resolving the items above, continue: ${command(preparation.resume)}`);
  return lines.join('\n') + '\n';
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
