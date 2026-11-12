// The companion owns API transport and credentials. fx reads its JSON envelopes
// and preserves authentication and throttling failures without fetching events.

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
    const url = host?.includes('://') ? host : `https://${host}`;
    // Current issue status and pagination must come from this observation, not a cached response.
    const env = {
      SENTRY_NO_CACHE: '1',
      ...(host === undefined ? {} : { SENTRY_URL: url, SENTRY_HOST: url }),
    };
    const result = await this.process.run([BINARY, ...args, '--json'], {
      timeoutMs,
      env,
      diagnostic: { phase: `${BINARY} ${args.slice(0, 2).join(' ')}`.trim() },
    });
    if (result.notStarted) throw toolMissing(BINARY);
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
  // The CLI repeats the project and wrapping errors before the network cause.
  // Keep the cause independent of the project so a shared outage reads once.
  const network = detail.indexOf('Network error');
  if (network >= 0)
    return new DevkitError(
      'network',
      'PLATFORM_QUERY_FAILED',
      `${BINARY}: ${detail.slice(network)}`,
      {
        nextSteps: ['Check connectivity and VPN, then retry.', `fx doctor --tool ${BINARY}`],
      },
    );
  return new DevkitError(
    categoryOf(call.code, call.stderr),
    'PLATFORM_QUERY_FAILED',
    `${BINARY} could not ${what}: ${detail}`,
    { nextSteps: [`fx doctor --tool ${BINARY}`] },
  );
}

function categoryOf(code: number, stderr: string): Category {
  if (/\b429\b|too many requests|rate limit/i.test(stderr)) return 'rate_limit';
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
