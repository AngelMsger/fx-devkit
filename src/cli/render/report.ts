// Compact workflow reports at the display boundary. Execution and error envelopes
// retain their full data; omitted counters describe filtering, never pagination.

import { hasExceptionalEvidence } from './exceptional.js';

// The commands whose result is a workflow report. The registry checks that each
// of them is a command that exists.
export const REPORT_COMMANDS = ['init', 'sync', 'doctor', 'release:check'] as const;
export type ReportCommand = (typeof REPORT_COMMANDS)[number];
const COLLECTIONS = new Set([
  'items',
  'repositories',
  'findings',
  'repairs',
  'links',
  'fx',
  'tools',
  'files',
  'tool_install',
  'installations',
]);
const RECOVERY = new Set([
  'preparation',
  'failure',
  'error',
  'handoff',
  'next_steps',
  'vector',
  'command',
  'warnings',
  'problems',
  'errors',
]);
// Initialization must show what was prepared, so callers can verify the task
// without rediscovering every repository, guide and Skill through separate commands.
const INITIALIZATION_EFFECTS = new Set([
  'sync.items',
  'sync.stage_details.docs.files',
  'sync.stage_details.skills.links',
  'sync.stage_details.skills.fx',
]);

export function reportCommand(id: string | undefined): ReportCommand | undefined {
  return REPORT_COMMANDS.find((name) => name === id);
}

export function compactReport(value: object): object {
  const omitted: Record<string, number> = {};
  const result = compactObject(value, omitted, '');
  return { ...result, output_mode: 'summary', omitted };
}

function compactObject(
  value: object,
  omitted: Record<string, number>,
  prefix: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const at = prefix ? `${prefix}.${key}` : key;
      if (
        value &&
        'operation' in value &&
        value.operation === 'apply' &&
        ['prepared', 'plan'].includes(key)
      ) {
        omitted[at] = 1;
        return [];
      }
      if (key === 'evidence') {
        omitted[at] = (omitted[at] ?? 0) + 1;
        return [];
      }
      if (
        RECOVERY.has(key) ||
        (key === 'setup' && prefix.endsWith('stage_details')) ||
        (key === 'plan' && 'operation' in value && value.operation === 'preview')
      )
        return [[key, item]];
      if (Array.isArray(item) && COLLECTIONS.has(key)) {
        const keepAll = INITIALIZATION_EFFECTS.has(at) || (key === 'files' && 'failure' in value);
        const visible = keepAll ? item.filter(selectedEffect) : item.filter(exceptional);
        omitted[at] = (omitted[at] ?? 0) + item.length - visible.length;
        return [[key, visible.map((row: unknown) => compactValue(row, omitted, at))]];
      }
      return [[key, compactValue(item, omitted, at)]];
    }),
  );
}

function selectedEffect(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('action' in value)) return true;
  return value.action !== 'skip_unpicked' && value.action !== 'skip_manifest';
}

function compactValue(value: unknown, omitted: Record<string, number>, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((item) => compactValue(item, omitted, prefix));
  return typeof value === 'object' && value !== null
    ? compactObject(value, omitted, prefix)
    : value;
}

function exceptional(value: unknown): boolean {
  if (hasExceptionalEvidence(value)) return true;
  if (typeof value !== 'object' || value === null) return true;
  const row = value as Record<string, unknown>;
  return (
    row['level'] === 'warn' ||
    row['level'] === 'fail' ||
    (row['origin'] === 'patch' && Array.isArray(row['vector']))
  );
}
