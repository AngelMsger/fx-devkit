// Compact workflow reports at the display boundary. Execution and error envelopes
// retain their full data; omitted counters describe filtering, never pagination.

import { hasPreparationIssue } from '../../domain/preparation.js';
import type { Notice } from '../../ports/reporter.js';

export type ReportCommand = 'init' | 'sync' | 'doctor' | 'release';
const COLLECTIONS = new Set([
  'items',
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

export function reportCommand(id: string | undefined): ReportCommand | undefined {
  return id === 'init' || id === 'sync' || id === 'doctor' || id === 'release' ? id : undefined;
}

export function compactReport(value: object): object {
  const omitted: Record<string, number> = {};
  const result = compactObject(value, omitted, '');
  return { ...result, output_mode: 'summary', omitted };
}

export function compactNotice(notice: Notice): Notice {
  if (notice.code !== 'INIT_PREPARED' || notice.data === undefined) return notice;
  return { ...notice, data: compactReport(notice.data) as Readonly<Record<string, unknown>> };
}

function compactObject(
  value: object,
  omitted: Record<string, number>,
  prefix: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const at = prefix ? `${prefix}.${key}` : key;
      if (key === 'evidence') {
        omitted[at] = (omitted[at] ?? 0) + 1;
        return [];
      }
      if (RECOVERY.has(key)) return [[key, item]];
      if (Array.isArray(item) && COLLECTIONS.has(key)) {
        const visible = item.filter(exceptional);
        omitted[at] = (omitted[at] ?? 0) + item.length - visible.length;
        return [[key, visible.map((row: unknown) => compactValue(row, omitted, at))]];
      }
      return [[key, compactValue(item, omitted, at)]];
    }),
  );
}

function compactValue(value: unknown, omitted: Record<string, number>, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((item) => compactValue(item, omitted, prefix));
  return typeof value === 'object' && value !== null
    ? compactObject(value, omitted, prefix)
    : value;
}

function exceptional(value: unknown): boolean {
  if (hasPreparationIssue(value)) return true;
  if (typeof value !== 'object' || value === null) return true;
  const row = value as Record<string, unknown>;
  return (
    row['level'] === 'warn' ||
    row['level'] === 'fail' ||
    (row['origin'] === 'patch' && Array.isArray(row['vector']))
  );
}
