// Column layout only. Colour and width negotiation are deliberately absent so
// the output is identical under a pipe, in CI logs and on a terminal.

import type { DiagnosticEvent } from '../../ports/diagnostics.js';
import type { Notice, ProgressEvent } from '../../ports/reporter.js';

export function humanList(
  items: readonly object[],
  columns?: readonly string[],
  noHeader = false,
): string {
  if (items.length === 0) return '(none)';
  const cols = columns ?? Object.keys(items[0] as Record<string, unknown>);
  const rows = items.map((item) =>
    cols.map((c) => cell(column(item as Record<string, unknown>, c))),
  );
  const widths = cols.map((column, i) =>
    Math.max(column.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const render = (row: readonly string[]): string =>
    row
      .map((value, i) => value.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  const body = rows.map(render);
  return (
    noHeader ? body : [render(cols), render(widths.map((width) => '-'.repeat(width))), ...body]
  ).join('\n');
}

// A column may name a nested value. --fields projects onto literal dotted keys,
// so a key the row actually has always wins over walking the same path.
function column(item: Record<string, unknown>, name: string): unknown {
  if (name in item) return item[name];
  return name
    .split('.')
    .reduce<unknown>(
      (at, key) =>
        typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined,
      item,
    );
}

type Describers = Readonly<Record<string, (value: unknown) => readonly string[]>>;

export function humanRecord(value: object, describe: Describers = {}): string {
  const entries = Object.entries(value as Record<string, unknown>);
  const width = Math.max(...entries.map(([k]) => k.length));
  const lines = (k: string, v: unknown): string[] => {
    const describer = describe[k];
    if (describer !== undefined) return [k, ...describer(v).map((l) => `  ${l}`)];
    if (isObjectList(v) && v.length > 8)
      return [`${k}  [${v.length} items; use --format json for details]`];
    if (isObjectList(v)) return [k, ...v.map((item) => `  - ${pairs(item)}`)];
    if (typeof v === 'object' && v !== null && !Array.isArray(v))
      return [
        k,
        ...humanRecord(v)
          .split('\n')
          .map((line) => `  ${line}`),
      ];
    return [`${k.padEnd(width)}  ${cell(v)}`];
  };
  return entries.flatMap(([k, v]) => lines(k, v)).join('\n');
}

function isObjectList(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v))
  );
}

function pairs(item: Record<string, unknown>): string {
  return Object.entries(item)
    .map(([k, v]) => `${k}: ${cell(v)}`)
    .join(', ');
}

export function humanNotice(notice: Notice): string {
  const lines = [`notice ${notice.code}: ${notice.message}`];
  for (const step of notice.nextSteps ?? []) lines.push(`  ${step}`);
  if (notice.silence !== undefined) lines.push(`  silence with ${notice.silence}`);
  return lines.join('\n');
}

function cell(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value))
    return value.length > 5
      ? `[${value.length} items; use --format json for details]`
      : value.map(cell).join(',');
  if (typeof value === 'object')
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}=${cell(v)}`)
      .join(' ');
  return String(value);
}

export function humanProgress(event: ProgressEvent): string {
  const detail = event.detail === undefined ? '' : `  ${event.detail}`;
  return `${event.id.padEnd(24)} ${event.state}${detail}`;
}

export function humanDiagnostic(event: DiagnosticEvent): string {
  const { kind, phase, ...detail } = event;
  const suffix = Object.keys(detail).length === 0 ? '' : `  ${cell(detail)}`;
  return `diagnostic ${kind}: ${phase}${suffix}`;
}
