// The `sentry` CLI is not a family tool: it answers `--json` with a `data`
// array and speaks in exit-code ranges (10–19 no credentials, 20–29 input,
// 30–39 the API) rather than the family's single codes. A rejected token
// surfaces as an API failure carrying "401 Unauthorized" (measured against
// sentry 0.42), so credentials are recognised by range or by that text.

import { type Category, DevkitError } from '../../../domain/errors.js';
import { stderrReason } from '../../../domain/toolchain/stderr.js';
import type { Process } from '../../../ports/process.js';
import { toolMissing } from '../../family/cli.js';

export const BINARY = 'sentry';

export interface SentryCall {
  readonly code: number;
  readonly data: unknown;
  readonly stderr: string;
}

export class SentryCli {
  constructor(private readonly process: Process) {}

  // The CLI picks its server from the environment; a manifest that names a
  // host is asking for that one, not for whichever was configured last.
  async call(args: readonly string[], timeoutMs: number, host?: string): Promise<SentryCall> {
    const env = host === undefined ? undefined : { SENTRY_URL: `https://${host}` };
    const result = await this.process.run([BINARY, ...args, '--json'], {
      timeoutMs,
      env,
      diagnostic: { phase: `${BINARY} ${args.slice(0, 2).join(' ')}`.trim() },
    });
    if (result.code === 127) throw toolMissing(BINARY);
    return { code: result.code, data: parse(result.stdout), stderr: result.stderr };
  }
}

const UNAUTHORIZED = /\b401\b|unauthori[sz]ed|invalid token|not authenticated/i;

export function sentryFailed(call: SentryCall, what: string): DevkitError {
  const detail = stderrReason(call.stderr, call.code);
  if ((call.code >= 10 && call.code <= 19) || UNAUTHORIZED.test(call.stderr)) {
    return new DevkitError('auth', 'PLATFORM_AUTH', `${BINARY} could not ${what}: ${detail}`, {
      nextSteps: [`fx login ${BINARY}`, `${BINARY} auth status`],
    });
  }
  return new DevkitError(
    categoryOf(call.code),
    'PLATFORM_QUERY_FAILED',
    `${BINARY} could not ${what}: ${detail}`,
    { nextSteps: [`fx doctor --tool ${BINARY}`] },
  );
}

function categoryOf(code: number): Category {
  if (code >= 20 && code <= 29) return 'not_found';
  return 'server';
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
