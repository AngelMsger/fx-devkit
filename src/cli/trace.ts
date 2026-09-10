// FX_TRACE: one JSON line per invocation, appended to the file it names, so
// an agent's route through fx can be read back afterwards. The line is
// nobody's result: a sink that fails costs the line, never the command.

import type { DevkitError } from '../domain/errors.js';

export interface TraceRecord {
  readonly ts: string;
  readonly argv: readonly string[];
  readonly exit: number;
  readonly code?: string;
  readonly ms: number;
  readonly cwd: string;
}

export type TraceSink = (line: string) => Promise<void>;

export class Trace {
  private code: string | undefined;

  constructor(
    private readonly sink: TraceSink,
    private readonly startedAt: number,
  ) {}

  failed(err: DevkitError): void {
    this.code = err.code;
  }

  async end(argv: readonly string[], exit: number, now: number): Promise<void> {
    const record: TraceRecord = {
      ts: new Date(now).toISOString(),
      argv,
      exit,
      ...(this.code === undefined ? {} : { code: this.code }),
      ms: now - this.startedAt,
      cwd: process.cwd(),
    };
    try {
      await this.sink(`${JSON.stringify(record)}\n`);
    } catch {
      return;
    }
  }
}

// The running invocation's trace, for the command boundary to report its
// failure to; main owns it.
export const invocation: { trace: Trace | undefined } = { trace: undefined };
