// Render results, progress and structured errors with separate data and diagnostic streams.

import type { Writable } from 'node:stream';

import { toEnvelope, type DevkitError } from '../../domain/errors.js';
import type { Format } from '../../domain/format.js';
import type { DiagnosticEvent, DiagnosticReporter } from '../../ports/diagnostics.js';
import type { Notice, ProgressEvent } from '../../ports/reporter.js';

import { unmatchedFields, project } from './fields.js';
import { humanDiagnostic, humanList, humanNotice, humanProgress, humanRecord } from './human.js';

export { parseFields, project } from './fields.js';
export { FORMATS, type Format } from '../../domain/format.js';

// `trailer` is what a report says about the whole list (a summary, stage
// outcomes): part of the envelope in json, one closing line in ndjson, and
// the command's own notices in human output.
export interface ListOptions {
  readonly hasMore?: boolean;
  readonly next?: string;
  readonly columns?: readonly string[];
  readonly trailer?: Readonly<Record<string, unknown>>;
}

// `describe` gives one key its own human lines, for a nested structure the
// generic key/value layout would flatten into noise; json ignores it.
export interface RecordOptions {
  readonly describe?: Readonly<Record<string, (value: unknown) => readonly string[]>>;
}

export interface Renderer extends DiagnosticReporter {
  record(value: object, options?: RecordOptions): void;
  list(items: readonly object[], options?: ListOptions): void;
  notice(notice: Notice): void;
  progress(event: ProgressEvent): void;
  error(err: DevkitError): void;
}

export interface RenderIo {
  readonly out: Writable;
  readonly err: Writable;
}

export function processIo(): RenderIo {
  return { out: process.stdout, err: process.stderr };
}

export interface RenderOptions {
  readonly fields?: readonly string[] | undefined;
  readonly quiet?: boolean | undefined;
  readonly verbose?: boolean | undefined;
  readonly noHeader?: boolean | undefined;
}

export function createRenderer(
  format: Format,
  io: RenderIo,
  options: RenderOptions = {},
): Renderer {
  const shape = (value: unknown): unknown => shapeResult(value, options, io);
  const line = (stream: Writable, text: string): void => {
    stream.write(text + '\n');
  };
  const shared = {
    emit: (event: DiagnosticEvent) => {
      if (!options.verbose) return;
      line(
        io.err,
        format === 'human' ? humanDiagnostic(event) : JSON.stringify({ _diagnostic: event }),
      );
    },
    error: (err: DevkitError) => line(io.err, JSON.stringify(toEnvelope(err))),
    notice: (notice: Notice) => {
      if (options.quiet) return;
      line(io.err, format === 'human' ? humanNotice(notice) : JSON.stringify({ _notice: notice }));
    },
    progress: (event: ProgressEvent) => {
      if (options.quiet) return;
      line(
        io.err,
        format === 'human' ? humanProgress(event) : JSON.stringify({ _progress: event }),
      );
    },
  };
  switch (format) {
    case 'json':
      return {
        ...shared,
        record: (value) => line(io.out, JSON.stringify(shape(value))),
        list: (items, opts = {}) => line(io.out, JSON.stringify(envelope(shape(items), opts))),
      };
    case 'ndjson':
      return {
        ...shared,
        record: (value) => line(io.out, JSON.stringify(shape(value))),
        list: (items, opts = {}) => {
          for (const item of items) line(io.out, JSON.stringify(shape(item)));
          if (opts.trailer !== undefined) line(io.out, JSON.stringify({ _trailer: opts.trailer }));
        },
      };
    case 'human':
      return {
        ...shared,
        record: (value, opts = {}) =>
          line(io.out, humanRecord(shape(value) as object, opts.describe ?? {})),
        list: (items, opts = {}) =>
          line(io.out, humanCollection(shape(items) as object[], opts, options)),
      };
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

function shapeResult(value: unknown, options: RenderOptions, io: RenderIo): unknown {
  if (options.fields === undefined) return value;
  const unmatched = unmatchedFields(value, options.fields);
  if (unmatched.length > 0 && !options.quiet)
    io.err.write(
      JSON.stringify({
        _notice: {
          code: 'FIELDS_UNMATCHED',
          message: `Fields absent from this result (possibly optional): ${unmatched.join(', ')}`,
          nextSteps: ['Inspect the result without --fields.'],
        },
      }) + '\n',
    );
  return project(value, options.fields);
}

function humanCollection(items: object[], opts: ListOptions, options: RenderOptions): string {
  const lines = [humanList(items, options.fields ?? opts.columns, options.noHeader)];
  if (opts.trailer !== undefined) {
    const trailer = options.verbose
      ? opts.trailer
      : Object.fromEntries(Object.entries(opts.trailer).filter(([key]) => key !== 'stage_details'));
    lines.push(humanRecord(trailer));
  }
  return lines.join('\n');
}
