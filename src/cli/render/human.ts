// The human layouts. Each says what a line means and leaves its appearance to the
// display: a plain display yields the exact text a pipe, a file and CI receive.

import { checkNote, type ErrorEnvelope, type HandoffEnvelope } from '../../domain/errors.js';
import { shellLine, type ResolvedShell } from '../../domain/shell.js';
import type { DiagnosticEvent } from '../../ports/diagnostics.js';
import type { Notice, ProgressEvent } from '../../ports/reporter.js';

import type { Display, LiveLine, Role } from './display.js';
import { roleOf } from './tone.js';
import { gap, widthOf } from './width.js';

const GUTTER = '  ';
const NARROWEST_COLUMN = 12;
// A list whose items stay within this reads best as one line each.
const ITEM_LINE = 100;

interface Cell {
  readonly text: string;
  readonly role: Role | undefined;
}

export function humanList(
  items: readonly object[],
  display: Display,
  columns?: readonly string[],
  noHeader = false,
): string {
  if (items.length === 0) return display.paint('quiet', '(none)');
  const names = columns ?? Object.keys(items[0] as Record<string, unknown>);
  const body = items.map((item) => names.map((name) => cellOf(column(item, name))));
  const widths = fitColumns(
    names.map((name, i) => Math.max(widthOf(name), ...body.map((row) => widthOf(row[i]!.text)))),
    names.map(widthOf),
    display.room(),
  );
  const line = (cells: readonly Cell[]): string =>
    cells
      .map(({ text, role }, i) => padded(display, role, display.clip(text, widths[i]!), widths[i]!))
      .join(GUTTER)
      .trimEnd();
  const heading = names.map((text): Cell => ({ text, role: 'strong' }));
  const rule = widths.map((width): Cell => ({ text: '-'.repeat(width), role: 'quiet' }));
  return [...(noHeader ? [] : [line(heading), line(rule)]), ...body.map(line)].join('\n');
}

// Shave the widest column until the table fits the room. The first column names the row
// and keeps its width; no other goes below its heading or the narrowest useful width,
// and a table that still cannot fit is left to wrap.
function fitColumns(
  natural: readonly number[],
  headings: readonly number[],
  room: number,
): number[] {
  const widths = [...natural];
  const floor = headings.map((heading, i) =>
    i === 0 ? Infinity : Math.max(heading, NARROWEST_COLUMN),
  );
  const total = widths.reduce((sum, width) => sum + width, GUTTER.length * (widths.length - 1));
  for (let excess = total - room; excess > 0; excess -= 1) {
    const widest = widths.reduce(
      (best, width, i) => (width > floor[i]! && width > (widths[best] ?? 0) ? i : best),
      -1,
    );
    if (widest < 0) break;
    widths[widest] = widths[widest]! - 1;
  }
  return widths;
}

// A column may name a nested value. --fields projects onto literal dotted keys,
// so a key the row actually has always wins over walking the same path.
function column(item: object, name: string): unknown {
  const row = item as Record<string, unknown>;
  if (name in row) return row[name];
  return name.split('.').reduce<unknown>((at, key) => (isRecord(at) ? at[key] : undefined), row);
}

export type Describers = Readonly<
  Record<string, (value: unknown, display: Display) => readonly string[]>
>;

export function humanRecord(value: object, display: Display, describe: Describers = {}): string {
  const entries = Object.entries(value as Record<string, unknown>);
  const width = Math.max(...entries.map(([key]) => widthOf(key)));
  const section = (key: string, body: readonly string[]): string[] => [
    display.paint('strong', key),
    ...body.map((line) => `  ${line}`),
  ];
  const field = (key: string, item: unknown): string[] => {
    const describer = describe[key];
    if (describer !== undefined) return section(key, describer(item, display));
    if (isRecordList(item) && item.length > 8)
      return [
        `${display.paint('quiet', key)}  [${item.length} items; use --format json for details]`,
      ];
    if (isRecordList(item)) return section(key, listItems(item, display));
    if (isRecord(item) && Object.keys(item).length > 0)
      return section(key, humanRecord(item, display).split('\n'));
    const { text, role } = cellOf(item);
    return [`${padded(display, 'quiet', key, width)}  ${display.paint(role, text)}`.trimEnd()];
  };
  return entries.flatMap(([key, item]) => field(key, item)).join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordList(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRecord);
}

// One line per item while every item stays short, otherwise one field per line.
// Either way a field with nothing in it is left out, and so is an item left with none.
function listItems(items: readonly Record<string, unknown>[], display: Display): string[] {
  const bullet = display.paint('quiet', '-');
  const entries = items
    .map((item) =>
      Object.entries(item)
        .map(([key, value]): [string, Cell] => [key, cellOf(value)])
        .filter(([, cell]) => cell.text !== ''),
    )
    .filter((fields) => fields.length > 0);
  const value = ({ text, role }: Cell): string => display.paint(role, text);
  const inline = entries.map((fields) => fields.map(([key, cell]) => `${key}: ${cell.text}`));
  if (inline.every((parts) => widthOf(parts.join(', ')) <= ITEM_LINE))
    return entries.map(
      (fields) =>
        `${bullet} ${fields
          .map(([key, cell]) => `${display.paint('quiet', `${key}:`)} ${value(cell)}`)
          .join(', ')}`,
    );
  return entries.flatMap((fields) => {
    const width = Math.max(...fields.map(([key]) => widthOf(key)));
    return fields.map(
      ([key, cell], i) =>
        `${i === 0 ? bullet : ' '} ${padded(display, 'quiet', key, width)}  ${value(cell)}`,
    );
  });
}

function cellOf(value: unknown): Cell {
  return { text: textOf(value), role: roleOf(value) };
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value))
    return value.length > 5
      ? `[${value.length} items; use --format json for details]`
      : value.map(textOf).join(',');
  if (typeof value === 'object')
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}=${textOf(v)}`)
      .join(' ');
  return String(value);
}

// Padding follows what the terminal shows, so paint never counts toward a column.
function padded(display: Display, role: Role | undefined, text: string, width: number): string {
  return display.paint(role, text) + gap(text, width);
}

export function humanNotice(notice: Notice, display: Display): string {
  return [
    headline(display, 'notice', notice.code, notice.message),
    ...steps(display, notice.nextSteps ?? []),
    ...(notice.silence === undefined
      ? []
      : [`  ${display.paint('quiet', `silence with ${notice.silence}`)}`]),
  ].join('\n');
}

const OUTCOME: Readonly<Partial<Record<ProgressEvent['state'], 'ok' | 'fail'>>> = {
  done: 'ok',
  fail: 'fail',
};

export function humanProgress(event: ProgressEvent, display: Display): string {
  const outcome = OUTCOME[event.state];
  const subject = `${display.mark(outcome)}${padded(display, undefined, event.id, 24)}`;
  const state = display.paint(outcome ?? 'quiet', event.state);
  const detail = event.detail === undefined ? '' : `  ${display.paint('quiet', event.detail)}`;
  return `${subject} ${state}${detail}`;
}

// What a status line says at one moment.
interface Status {
  readonly tick: number;
  readonly title: string;
  readonly elapsedMs: number;
  readonly counts: readonly StatusCount[];
  // What is under way, the longest-running first: that is the one a person waits on.
  readonly underway: readonly Underway[];
}

interface StatusCount {
  readonly id: string;
  readonly phase?: string | undefined;
  readonly total: number;
  readonly completed: number;
}

export interface Underway {
  readonly name: string;
  readonly ms: number;
}

// More names than this say less than their number does.
const UNDERWAY_SHOWN = 3;
// What has only just begun is not yet what a person is waiting on, and has no age to show.
const LASTING_MS = 1000;

// One line that never wraps: the parts come in order of importance and the first that
// does not fit is shortened and ends the line.
export function humanStatus(status: Status, display: Display, live: LiveLine): string {
  const lasting = status.underway.filter(({ ms }) => ms >= LASTING_MS);
  const shown = lasting.slice(0, UNDERWAY_SHOWN).map(({ name, ms }) => `${name} ${age(ms)}`);
  const more = lasting.length - shown.length;
  const part = (text: string): string => (text === '' ? '' : `${GUTTER}${text}`);
  const cells: Cell[] = [
    { text: `${live.frame(status.tick)} `, role: 'accent' },
    { text: status.title, role: 'strong' },
    { text: status.elapsedMs < LASTING_MS ? '' : ` ${age(status.elapsedMs)}`, role: 'quiet' },
    ...status.counts.map(({ id, phase, completed, total }): Cell => ({
      text: part([id, phase, `${completed}/${total}`].filter(Boolean).join(' ')),
      role: undefined,
    })),
    { text: part(`${shown.join(', ')}${more > 0 ? ` +${more}` : ''}`), role: 'quiet' },
  ];
  let line = '';
  let used = 0;
  for (const cell of cells) {
    const text = live.fit(cell.text, used);
    line += display.paint(cell.role, text);
    used += widthOf(text);
    if (text !== cell.text) break;
  }
  return line;
}

function age(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds}s` : `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
}

export function humanDiagnostic(event: DiagnosticEvent, display: Display): string {
  const { kind, phase, ...detail } = event;
  const suffix = Object.keys(detail).length === 0 ? '' : `  ${textOf(detail)}`;
  return display.paint('quiet', `diagnostic ${kind}: ${phase}${suffix}`);
}

// What a person at a terminal reads in place of the envelope: its code, message, hint,
// next steps and hand-off. The category and retryability stay with the exit code and
// the envelope.
export function humanError(
  error: ErrorEnvelope['error'],
  display: Display,
  shell: ResolvedShell,
): string {
  const [summary = '', ...more] = error.message.split('\n');
  return [
    headline(display, 'error', error.code, display.paint('strong', summary)),
    ...more.map((line) => `  ${line}`),
    `  ${error.hint}`,
    ...steps(display, error.next_steps),
    ...(error.handoff === undefined ? [] : handoffLines(error.handoff, display, shell)),
  ].join('\n');
}

function handoffLines(handoff: HandoffEnvelope, display: Display, shell: ResolvedShell): string[] {
  const detail = (line: string): string => `     ${line}`;
  return [
    '',
    `  ${display.paint('strong', handoff.summary)}`,
    ...handoff.user_steps.flatMap((step, i) => [
      `  ${i + 1}. ${step.title}`,
      ...[checkNote(step)].flatMap((note) => (note === undefined ? [] : [detail(note)])),
      ...(step.instructions === undefined ? [] : [detail(step.instructions)]),
      ...(step.open === undefined ? [] : [detail(`Open: ${step.open}`)]),
      ...(step.command === undefined
        ? []
        : [detail(display.paint('accent', shellLine(step.command, shell)))]),
      ...(step.expects === undefined ? [] : [detail(`Expected: ${step.expects.path}`)]),
    ]),
    ...steps(display, [
      ...(handoff.command === undefined ? [] : [handoff.command]),
      ...(handoff.alternatives ?? []),
    ]),
  ];
}

// The first line of a notice and of an error: its label, its code, then what it says.
function headline(display: Display, kind: 'notice' | 'error', code: string, text: string): string {
  const label = display.paint(kind === 'error' ? 'fail' : 'accent', display.label[kind]);
  return `${label} ${display.paint('quiet', `${code}:`)} ${text}`;
}

function steps(display: Display, lines: readonly string[]): string[] {
  return lines.map((line) => `  ${display.mark('step')}${line}`);
}
