// Render results, progress and structured errors with separate data and diagnostic streams.

import type { Writable } from 'node:stream';

import { toEnvelope, type DevkitError } from '../../domain/errors.js';
import type { Format } from '../../domain/format.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { DiagnosticEvent, DiagnosticReporter } from '../../ports/diagnostics.js';
import type { Notice, ProgressEvent } from '../../ports/reporter.js';

import { displayOf, PLAIN, type Display } from './display.js';
import { unmatchedFields, project } from './fields.js';
import {
  humanDiagnostic,
  humanError,
  humanList,
  humanNotice,
  humanProgress,
  humanRecord,
  type Describers,
} from './human.js';
import { compactReport, type ReportCommand } from './report.js';
import { statusLineOn, type StatusLine } from './status-line.js';

export { parseFields, project } from './fields.js';
export { FORMATS, type Format } from '../../domain/format.js';

export interface ListOptions {
  readonly hasMore?: boolean;
  readonly next?: string;
  readonly columns?: readonly string[];
  // Merged into the JSON envelope, emitted as a final NDJSON record, or shown
  // below the human table. Notices use the separate diagnostic stream.
  readonly trailer?: Readonly<Record<string, unknown>>;
  // A human findings table may display only one part of the workflow report.
  readonly fullReport?: object;
}

// `describe` gives one key its own human lines, for a nested structure the
// generic key/value layout would flatten into noise; json ignores it.
export interface RecordOptions {
  readonly describe?: Describers;
}

// One display per stream: stdout may be piped while stderr still faces a person.
export interface Displays {
  readonly out: Display;
  readonly err: Display;
}

export interface Renderer extends DiagnosticReporter {
  // How each stream shows a human view; plain in every other format.
  readonly display: Displays;
  // Present where a person watches stderr work; everything written goes around it.
  readonly status: StatusLine | undefined;
  record(value: object, options?: RecordOptions): void;
  list(items: readonly object[], options?: ListOptions): void;
  // A document the command emits verbatim, such as a schema, a Skill file or a
  // generated script. The caller owns its exact bytes, trailing newline
  // included, and no format or projection option touches them.
  text(value: string): void;
  notice(notice: Notice): void;
  progress(event: ProgressEvent): void;
  error(err: DevkitError): void;
}

export interface RenderIo {
  readonly out: Writable;
  readonly err: Writable;
  // What a terminal's abilities depend on besides the stream itself.
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

export function processIo(): RenderIo {
  return { out: process.stdout, err: process.stderr, env: process.env, platform: process.platform };
}

export interface RenderOptions {
  readonly report?: ReportCommand | undefined;
  readonly details?: boolean | undefined;
  readonly fields?: readonly string[] | undefined;
  readonly quiet?: boolean | undefined;
  readonly verbose?: boolean | undefined;
  readonly noHeader?: boolean | undefined;
  // Quotes the commands a human error view prints.
  readonly shell?: ResolvedShell | undefined;
}

// What every way of writing a result shares.
interface Rendering {
  readonly format: Format;
  readonly options: RenderOptions;
  readonly display: Display;
  readonly out: Write;
  readonly projectionNotice: (notice: Notice) => void;
}

type Write = (text: string) => void;

// How text reaches each stream, around the status line where there is one. stdout takes
// text as it is, since a document is written verbatim; stderr only ever takes lines.
interface Writes {
  readonly out: Write;
  readonly err: Write;
}

function writesTo(io: RenderIo, status: StatusLine | undefined): Writes {
  if (status === undefined)
    return { out: (text) => io.out.write(text), err: (text) => io.err.write(`${text}\n`) };
  return {
    out: (text) => status.aside(() => io.out.write(text), text.endsWith('\n')),
    err: (text) => status.above(text),
  };
}

function displaysFor(format: Format, io: RenderIo): Displays {
  if (format !== 'human') return { out: PLAIN, err: PLAIN };
  const of = (stream: Writable): Display =>
    displayOf(stream, io.env ?? {}, io.platform ?? process.platform);
  return { out: of(io.out), err: of(io.err) };
}

export function createRenderer(
  format: Format,
  io: RenderIo,
  options: RenderOptions = {},
): Renderer {
  const compact =
    format === 'json' &&
    options.report !== undefined &&
    !options.details &&
    options.fields === undefined;
  const display = displaysFor(format, io);
  const status = options.quiet ? undefined : statusLineOn(io.err, display.err);
  const writes = writesTo(io, status);
  const { projectionNotice, ...said } = diagnosticRenderer(format, options, display.err, {
    err: writes.err,
    status,
  });
  const rendering: Rendering = {
    format,
    options,
    display: display.out,
    out: writes.out,
    projectionNotice,
  };
  return {
    ...said,
    display,
    status,
    record: (value, opts = {}) => {
      const result = shapeResult(rendering, compact ? compactReport(value) : value) as object;
      line(
        rendering,
        format === 'human'
          ? humanRecord(result, display.out, opts.describe)
          : JSON.stringify(result),
      );
    },
    list: (items, opts = {}) => renderList(rendering, items, opts, compact),
    text: (value) => writes.out(value),
  };
}

function renderList(
  rendering: Rendering,
  items: readonly object[],
  opts: ListOptions,
  compact: boolean,
): void {
  const { format, options, display } = rendering;
  if (options.report !== undefined && options.fields !== undefined) {
    const result = shapeResult(rendering, opts.fullReport ?? envelope(items, opts)) as object;
    line(rendering, format === 'human' ? humanRecord(result, display) : JSON.stringify(result));
    return;
  }
  if (format === 'json' && compact) {
    line(rendering, JSON.stringify(compactReport(envelope(items, opts))));
    return;
  }
  const rows = shapeResult(rendering, items) as object[];
  if (format === 'json') line(rendering, JSON.stringify(envelope(rows, opts)));
  else if (format === 'human') line(rendering, humanCollection(rendering, rows, opts));
  else {
    for (const item of rows) line(rendering, JSON.stringify(item));
    if (opts.trailer !== undefined) line(rendering, JSON.stringify({ _trailer: opts.trailer }));
  }
}

function envelope(items: unknown, options: ListOptions): Record<string, unknown> {
  return {
    items,
    has_more: options.hasMore ?? false,
    ...(options.next === undefined ? {} : { next: options.next }),
    ...(options.trailer ?? {}),
  };
}

function shapeResult(rendering: Rendering, value: unknown): unknown {
  const { fields } = rendering.options;
  if (fields === undefined) return value;
  const unmatched = unmatchedFields(value, fields);
  if (unmatched.length > 0)
    rendering.projectionNotice({
      code: 'FIELDS_UNMATCHED',
      message: `Fields absent from this result (possibly optional): ${unmatched.join(', ')}`,
      nextSteps: ['Inspect the result without --fields.'],
    });
  return project(value, fields);
}

function humanCollection(rendering: Rendering, items: object[], opts: ListOptions): string {
  const { options, display } = rendering;
  const table = humanList(items, display, options.fields ?? opts.columns, options.noHeader);
  const trailer = Object.entries(opts.trailer ?? {}).filter(
    ([key]) => options.verbose || key !== 'stage_details',
  );
  if (trailer.length === 0) return table;
  return [table, '', humanRecord(Object.fromEntries(trailer), display)].join('\n');
}

function line(rendering: Rendering, text: string): void {
  rendering.out(text + '\n');
}

type Said = Pick<Renderer, 'emit' | 'error' | 'notice' | 'progress'>;

function diagnosticRenderer(
  format: Format,
  options: RenderOptions,
  display: Display,
  { err, status }: Pick<Writes, 'err'> & Pick<Renderer, 'status'>,
): Said & Pick<Rendering, 'projectionNotice'> {
  const human = format === 'human';
  // An error and a notice about --fields answer whoever built the request, so a program
  // reads them structured in every format; only a person watching a terminal in the
  // human format reads them as text.
  const answer = (structured: object, text: () => string): void =>
    err(human && display.interactive ? text() : JSON.stringify(structured));
  return {
    emit: (event: DiagnosticEvent) => {
      if (!options.verbose) return;
      err(human ? humanDiagnostic(event, display) : JSON.stringify({ _diagnostic: event }));
    },
    error: (err: DevkitError) => {
      const envelope = toEnvelope(err);
      answer(envelope, () => humanError(envelope.error, display, options.shell ?? 'posix'));
    },
    projectionNotice: (notice: Notice) => {
      if (options.quiet) return;
      answer({ _notice: notice }, () => humanNotice(notice, display));
    },
    notice: (notice: Notice) => {
      if (options.quiet) return;
      err(human ? humanNotice(notice, display) : JSON.stringify({ _notice: notice }));
    },
    progress: (event: ProgressEvent) => {
      if (options.quiet || status?.takes(event)) return;
      err(human ? humanProgress(event, display) : JSON.stringify({ _progress: event }));
    },
  };
}
