// The shared structured failure and recovery contract; category determines the command exit code.

import type { DiagnosticEvent } from './diagnostics.js';

export const CATEGORIES = [
  'usage',
  'config',
  'auth',
  'permission',
  'not_found',
  'conflict',
  'rate_limit',
  'network',
  'server',
  'parse',
  'internal',
] as const;

export type Category = (typeof CATEGORIES)[number];

const EXIT_CODE: Record<Category, number> = {
  internal: 1,
  usage: 2,
  config: 3,
  auth: 4,
  permission: 5,
  not_found: 6,
  rate_limit: 7,
  network: 8,
  server: 9,
  parse: 10,
  conflict: 11,
};

const RETRYABLE: ReadonlySet<Category> = new Set(['rate_limit', 'network', 'server']);

export interface Guidance {
  readonly hint: string;
  readonly nextSteps: readonly string[];
}

const GUIDANCE: Record<Category, Guidance> = {
  usage: { hint: 'The command was invoked incorrectly.', nextSteps: ['fx <command> --help'] },
  config: {
    hint: 'The configuration or workspace state is missing or invalid.',
    nextSteps: ['fx doctor', 'fx config list'],
  },
  auth: {
    hint: 'A companion tool rejected or lacks credentials.',
    nextSteps: ['fx doctor', 'fx login <tool>'],
  },
  permission: {
    hint: 'The operation is not allowed with the current access or posture.',
    nextSteps: ['fx doctor'],
  },
  not_found: {
    hint: 'The named repository, environment, tool or key does not exist.',
    nextSteps: ['fx repo list', 'fx env list', 'fx tool list'],
  },
  conflict: {
    hint: 'Local state diverged from what the command expected. Inspect the reported outcome before retrying.',
    nextSteps: ['fx status', 'Resolve the local state, then retry.'],
  },
  rate_limit: { hint: 'A service is throttling requests.', nextSteps: ['Wait, then retry.'] },
  network: {
    hint: 'A service could not be reached.',
    nextSteps: ['Check connectivity and VPN, then retry.'],
  },
  server: { hint: 'A service returned an internal error.', nextSteps: ['Retry later.'] },
  parse: {
    hint: 'A document or tool output could not be parsed.',
    nextSteps: ['Retry with --verbose to inspect the raw input.'],
  },
  internal: {
    hint: 'An unexpected internal error occurred.',
    nextSteps: ['Retry with --verbose and report the output.'],
  },
};

export interface HandoffStep {
  readonly id: string;
  readonly kind: 'run' | 'manual' | 'file';
  readonly title: string;
  readonly instructions?: string;
  readonly open?: string;
  readonly command?: readonly string[];
  readonly expects?: { readonly path: string };
}

export interface Handoff {
  readonly summary: string;
  readonly userSteps: readonly HandoffStep[];
  readonly command?: string;
  readonly alternatives?: readonly string[];
}

export interface ErrorOptions {
  readonly retryable?: boolean;
  readonly hint?: string;
  readonly nextSteps?: readonly string[];
  readonly handoff?: Handoff;
  readonly cause?: unknown;
  readonly diagnostics?: readonly DiagnosticEvent[];
}

export class DevkitError extends Error {
  readonly hint: string;
  readonly nextSteps: readonly string[];
  readonly retryable: boolean;
  readonly handoff: Handoff | undefined;
  readonly diagnostics: readonly DiagnosticEvent[];

  constructor(
    readonly category: Category,
    readonly code: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DevkitError';
    this.hint = options.hint ?? GUIDANCE[category].hint;
    this.nextSteps = options.nextSteps ?? GUIDANCE[category].nextSteps;
    this.retryable = options.retryable ?? RETRYABLE.has(category);
    this.handoff = options.handoff;
    this.diagnostics = options.diagnostics ?? [];
  }
}

export function defaultGuidance(category: Category): Guidance {
  return GUIDANCE[category];
}

export function exitCodeFor(category: Category): number {
  return EXIT_CODE[category];
}

export function asDevkitError(err: unknown): DevkitError {
  if (err instanceof DevkitError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new DevkitError('internal', 'INTERNAL', message, { cause: err });
}

export interface ErrorEnvelope {
  readonly error: {
    readonly category: Category;
    readonly code: string;
    readonly message: string;
    readonly hint: string;
    readonly next_steps: readonly string[];
    readonly retryable: boolean;
    readonly handoff?: HandoffEnvelope;
  };
}

// The wire shape of a handoff, shared by error envelopes and by answers
// that carry one as data (need, doctor).
export interface HandoffEnvelope {
  readonly summary: string;
  readonly user_steps: readonly HandoffStep[];
  readonly command?: string;
  readonly alternatives?: readonly string[];
}

export function toEnvelope(err: DevkitError): ErrorEnvelope {
  const base = {
    category: err.category,
    code: err.code,
    message: err.message,
    hint: err.hint,
    next_steps: err.nextSteps,
    retryable: err.retryable,
  };
  return { error: err.handoff ? { ...base, handoff: handoffEnvelope(err.handoff) } : base };
}

export function handoffEnvelope(handoff: Handoff): HandoffEnvelope {
  return {
    summary: handoff.summary,
    user_steps: handoff.userSteps,
    ...(handoff.command === undefined ? {} : { command: handoff.command }),
    ...(handoff.alternatives === undefined ? {} : { alternatives: handoff.alternatives }),
  };
}
