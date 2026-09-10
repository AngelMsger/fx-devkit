// The three output formats behind one interface. Whatever the format, stdout carries
// data only and every diagnostic goes to stderr; the error envelope is JSON even in
// human mode so an agent can always parse it.

import type { Writable } from 'node:stream';

import { toEnvelope, type DevkitError } from '../../domain/errors.js';
import type { Format } from '../../domain/format.js';
import type { DiagnosticEvent, DiagnosticReporter } from '../../ports/diagnostics.js';
import type { Notice, ProgressEvent } from '../../ports/reporter.js';

import { project } from './fields.js';
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
  const shape = (value: unknown): unknown =>
    options.fields === undefined ? value : project(value, options.fields);
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
          line(
            io.out,
            humanList(shape(items) as object[], options.fields ?? opts.columns, options.noHeader),
          ),
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
