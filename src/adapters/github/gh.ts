// gh, the GitHub CLI, serves two providers: the github code host and GitHub Actions
// ci. This is the one place that runs it. gh reports a failed request as an HTTP
// status on stderr, so a failure is translated into the family's exit categories and
// classified by the same `queryFailed` every companion's failures go through.

import type { SetupRecipe } from '../../domain/setup/types.js';
import { stderrReason } from '../../domain/toolchain/stderr.js';
import type { Process } from '../../ports/process.js';
import { EXIT, toolMissing, type CliCall } from '../family/cli.js';

export const BINARY = 'gh';

export type { CliCall } from '../family/cli.js';

// One sign-in serves both providers; the same step from either is planned once.
export const GH_RECIPES: readonly SetupRecipe[] = [
  {
    id: 'login',
    tool: BINARY,
    perEnv: false,
    kind: 'run',
    phase: 'authenticate',
    title: 'Log in to GitHub',
    instructions:
      'Signs gh in through the browser or with a token. fx reads repositories and Actions runs with that sign-in; private repositories need the repo scope gh asks for by default.',
    run: ['auth', 'login'],
    verify: { command: ['auth', 'status'] },
  },
];

export interface GhCallOptions {
  readonly timeoutMs?: number | undefined;
}

export class GhCli {
  constructor(private readonly process: Process) {}

  async call(args: readonly string[], options: GhCallOptions = {}): Promise<CliCall> {
    const result = await this.process.run([BINARY, ...args], {
      timeoutMs: options.timeoutMs,
      diagnostic: { phase: `${BINARY} ${args.slice(0, 2).join(' ')}`.trim() },
    });
    if (result.notStarted === true || result.code === EXIT.missing_binary)
      throw toolMissing(BINARY);
    if (result.code === 0)
      return { code: 0, stdout: result.stdout, data: parse(result.stdout), error: undefined };
    const status = httpStatus(result.stderr);
    const message = stderrReason(result.stderr, result.code).replace(/^gh: /, '');
    return {
      code: exitOf(result.code, status, message),
      stdout: result.stdout,
      data: undefined,
      error: { message, ...(status === undefined ? {} : { http_status: status }) },
    };
  }
}

// `--paginate --jq` prints one JSON value per line. A line that does not parse makes
// the whole answer unreadable rather than shorter.
export function jsonLines(text: string): unknown[] | undefined {
  const values: unknown[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const value = parse(line);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

// `gh api` ends its message with "(HTTP 404)"; other commands open it with "HTTP 404:".
function httpStatus(stderr: string): number | undefined {
  const match = /\(HTTP (\d{3})\)|^HTTP (\d{3}):/m.exec(stderr);
  const status = match?.[1] ?? match?.[2];
  return status === undefined ? undefined : Number(status);
}

// gh's own exit 4 means it holds no credential at all. Any other failure is a plain
// failure: gh's remaining codes (cancelled, pending checks) would read as categories.
function exitOf(code: number, status: number | undefined, message: string): number {
  if (code === 4 || status === 401) return EXIT.auth;
  if (status === 429 || (status === 403 && /rate limit/i.test(message))) return EXIT.rate_limit;
  if (status === 403) return EXIT.permission;
  if (status === 404) return EXIT.not_found;
  if (status !== undefined && status >= 500) return EXIT.server;
  if (/error connecting to/i.test(message)) return EXIT.network;
  return 1;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
