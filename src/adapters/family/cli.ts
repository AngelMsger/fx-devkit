// The thin layer over a family CLI subprocess (bitbucket-cli, jenkins-cli):
// one place that knows the global flags, the JSON envelopes and the family
// exit codes, so a provider above it reads like a description of its
// platform, not of a CLI. Raw stdout is kept because some answers are not
// JSON at all (a file's bytes).

import { type Category, DevkitError } from '../../domain/errors.js';
import { errorEnvelope, stderrReason } from '../../domain/toolchain/stderr.js';
import type { Process, ProcessResult } from '../../ports/process.js';

export interface CliCall {
  readonly code: number;
  readonly stdout: string;
  readonly data: unknown;
  readonly error:
    | { readonly code?: string; readonly http_status?: number; readonly message?: string }
    | undefined;
}

export interface CallOptions {
  readonly timeoutMs?: number | undefined;
}

export const EXIT = {
  auth: 4,
  permission: 5,
  not_found: 6,
  rate_limit: 7,
  network: 8,
  server: 9,
  conflict: 11,
  missing_binary: 127,
} as const;

export class FamilyCli {
  constructor(
    private readonly binary: string,
    private readonly process: Process,
    private readonly context: string | undefined,
  ) {}

  async call(args: readonly string[], options: CallOptions = {}): Promise<CliCall> {
    const global = [
      '--format',
      'json',
      ...(this.context === undefined ? [] : ['--use-context', this.context]),
    ];
    const result = await this.process.run([this.binary, ...global, ...args], {
      timeoutMs: options.timeoutMs,
      diagnostic: { phase: `${this.binary} ${args.slice(0, 2).join(' ')}`.trim() },
    });
    if (result.code === EXIT.missing_binary) throw toolMissing(this.binary);
    return {
      code: result.code,
      stdout: result.stdout,
      data: parse(result.stdout),
      error: envelope(result),
    };
  }
}

export function toolMissing(binary: string): DevkitError {
  return new DevkitError('config', 'TOOL_MISSING', `${binary} is not installed or not on PATH`, {
    hint: 'The platform is driven through its own CLI.',
    nextSteps: [`fx can ${binary}`, `fx tool install ${binary}`],
  });
}

// A failed query, classified by the family exit code: credentials, access,
// or the platform itself; never a guess at what the answer would have been.
export function queryFailed(binary: string, call: CliCall, what: string): DevkitError {
  const detail = call.error?.message ?? `exit ${call.code}`;
  if (call.code === EXIT.auth) {
    return new DevkitError('auth', 'PLATFORM_AUTH', `${binary} could not ${what}: ${detail}`, {
      nextSteps: [`fx login ${binary}`, `${binary} auth status`],
    });
  }
  if (call.code === EXIT.permission) {
    return new DevkitError(
      'permission',
      'PLATFORM_FORBIDDEN',
      `${binary} may not ${what}: ${detail}`,
      { nextSteps: [`fx can ${binary}`] },
    );
  }
  return new DevkitError(
    categoryOf(call.code),
    'PLATFORM_QUERY_FAILED',
    `${binary} could not ${what}: ${detail}`,
    { nextSteps: [`fx doctor --tool ${binary}`] },
  );
}

// A zero exit whose payload cannot be read is a failure too: dropping the
// rows that did not parse would turn a changed schema into a confident
// "nothing to report".
export function unreadable(binary: string, what: string): DevkitError {
  return new DevkitError(
    'server',
    'PLATFORM_QUERY_FAILED',
    `${binary} answered with ${what} it could not read`,
    { nextSteps: [`fx doctor --tool ${binary}`] },
  );
}

export function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// A family list answer is `{items, has_more, next?}`; a bare array is
// accepted for tools that answer without the envelope. undefined means the
// answer is not a list of records, does not say whether it is complete, or
// is short of its own last page — each of which would otherwise read as
// "there is nothing there".
export function itemsOf(value: unknown): Record<string, unknown>[] | undefined {
  const envelope = objectOf(value);
  const list = Array.isArray(value) ? value : envelope?.['items'];
  if (!Array.isArray(list)) return undefined;
  if (envelope !== undefined && typeof envelope['has_more'] !== 'boolean') return undefined;
  if (envelope?.['has_more'] === true) return undefined;
  const rows = list.map(objectOf);
  return rows.every((row) => row !== undefined) ? (rows as Record<string, unknown>[]) : undefined;
}

export function stringAt(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function categoryOf(code: number): Category {
  if (code === EXIT.rate_limit) return 'rate_limit';
  if (code === EXIT.network) return 'network';
  return 'server';
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function envelope(result: ProcessResult): CliCall['error'] {
  if (result.code === 0) return undefined;
  const error = errorEnvelope(result.stderr);
  return error === undefined ? { message: stderrReason(result.stderr, result.code) } : error;
}
