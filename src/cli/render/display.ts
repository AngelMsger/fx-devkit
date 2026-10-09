// How one output stream shows text. Only a terminal is decorated, whatever the environment
// says: a pipe, a file and CI receive the same text without control sequences, symbols
// or fitting, so what an agent reads never depends on where a person is looking.

import type { Writable } from 'node:stream';

import { truncate, widthOf, wrap } from './width.js';

// What a piece of text means, never how it looks.
export type Role = 'ok' | 'warn' | 'fail' | 'accent' | 'strong' | 'quiet';
// What may stand in front of a line: a verdict on it, or a step to take next.
export type Mark = 'ok' | 'fail' | 'step';

export interface Display {
  // A person reads this stream; no program parses it.
  readonly interactive: boolean;
  // What introduces a notice and an error.
  readonly label: Readonly<Record<'notice' | 'error', string>>;
  paint(role: Role | undefined, text: string): string;
  // The column in front of a line: a symbol, its blank when the line carries none, or
  // nothing at all where symbols are not shown.
  mark(mark?: Mark): string;
  // The columns left on a line after `reserved`; unbounded where nothing wraps.
  room(reserved?: number): number;
  // Shortens only where `room` is bounded, so plain text is never cut.
  clip(text: string, width: number): string;
  // Breaks into lines only where `room` is bounded; plain text stays the one line it was.
  wrap(text: string, width: number): string[];
  // Absent wherever a line cannot be redrawn, which is everything but a terminal that
  // moves its cursor.
  readonly live: LiveLine | undefined;
}

// A line redrawn in place while fx works.
export interface LiveLine {
  // The busy indicator at one moment of its turn.
  frame(tick: number): string;
  // Shortens to the columns the line may fill right now: a line that wraps cannot be
  // redrawn, so this holds even where the terminal reports no size.
  fit(text: string, reserved?: number): string;
  // What puts `text` on the cursor's line in place of what is there; empty text clears it.
  redraw(text: string): string;
}

const SYMBOL = { ok: '✓', fail: '✗', step: '→', notice: '●', ellipsis: '…' } as const;
const BUSY = {
  symbols: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  plain: ['-', '\\', '|', '/'],
} as const;
// What a terminal that reports no size is taken to have.
const ASSUMED_COLUMNS = 80;
const MARK_ROLE: Readonly<Record<Mark, Role>> = { ok: 'ok', fail: 'fail', step: 'quiet' };

// The sixteen-colour set only: it follows the palette the person chose for their terminal.
const SGR: Readonly<Record<Role, readonly [open: number, close: number]>> = {
  ok: [32, 39],
  warn: [33, 39],
  fail: [31, 39],
  accent: [36, 39],
  strong: [1, 22],
  quiet: [2, 22],
};

interface Capabilities {
  readonly interactive: boolean;
  readonly colour: boolean;
  readonly symbols: boolean;
  readonly columns: number | undefined;
  // Reads the width as it is now, where lines can be redrawn: a terminal may be resized
  // while one is showing.
  readonly redraws: (() => number | undefined) | undefined;
}

export const PLAIN: Display = createDisplay({
  interactive: false,
  colour: false,
  symbols: false,
  columns: undefined,
  redraws: undefined,
});

function createDisplay(can: Capabilities): Display {
  const paint = (role: Role | undefined, text: string): string => {
    if (!can.colour || role === undefined || text === '') return text;
    const [open, close] = SGR[role];
    return `\u001b[${open}m${text}\u001b[${close}m`;
  };
  const ellipsis = can.symbols ? SYMBOL.ellipsis : '...';
  return {
    interactive: can.interactive,
    label: can.symbols
      ? { notice: SYMBOL.notice, error: SYMBOL.fail }
      : { notice: 'notice', error: 'error' },
    paint,
    mark: (mark) => {
      if (!can.symbols) return '';
      return mark === undefined ? '  ' : `${paint(MARK_ROLE[mark], SYMBOL[mark])} `;
    },
    // The last column stays free: a line that fills it wraps on some consoles.
    room: (reserved = 0) => (can.columns === undefined ? Infinity : can.columns - 1 - reserved),
    clip: (text, width) => (can.columns === undefined ? text : truncate(text, width, ellipsis)),
    wrap: (text, width) => (can.columns === undefined ? [text] : wrap(text, width)),
    live: can.redraws && liveLine(can.redraws, can.symbols ? BUSY.symbols : BUSY.plain, ellipsis),
  };
}

function liveLine(
  columns: () => number | undefined,
  frames: readonly string[],
  ellipsis: string,
): LiveLine {
  return {
    frame: (tick) => frames[tick % frames.length]!,
    fit: (text, reserved = 0) => {
      const room = (columns() ?? ASSUMED_COLUMNS) - 1 - reserved;
      // Where not even the ellipsis fits, nothing does.
      return room < widthOf(ellipsis) ? '' : truncate(text, room, ellipsis);
    },
    // Carriage return, the text, then erase to the end of the line.
    redraw: (text) => `\r${text}\u001b[K`,
  };
}

type Stream = Writable & {
  readonly isTTY?: boolean;
  readonly columns?: number;
  hasColors?(env: NodeJS.ProcessEnv): boolean;
};

// Colour, symbols and width are separate abilities of a terminal: NO_COLOR and TERM=dumb
// take the colour away and leave the rest.
export function displayOf(
  stream: Stream,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Display {
  if (stream.isTTY !== true) return PLAIN;
  return createDisplay({
    interactive: true,
    colour: stream.hasColors?.(env) ?? false,
    symbols: drawsSymbols(env, platform),
    // Some pseudo-terminals report no width at all.
    columns: stream.columns || undefined,
    // A dumb terminal prints control sequences instead of obeying them.
    redraws: env['TERM'] === 'dumb' ? undefined : () => stream.columns || undefined,
  });
}

// The legacy Windows console announces none of these and cannot draw the symbols.
function drawsSymbols(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return env['TERM'] !== 'linux';
  return [env['WT_SESSION'], env['TERM_PROGRAM'], env['TERM']].some((value) => value !== undefined);
}
