// A lifecycle worker lends every companion command the remaining task budget, and tells
// a command that takes a deadline of its own what it was lent. The underlying process
// adapter retains responsibility for cancellation.

import { DevkitError } from '../../domain/errors.js';
import type { CommandDeadline } from '../../domain/setup/types.js';
import type { Process, ProcessResult, RunOptions } from '../../ports/process.js';

export interface DeadlineBudget {
  // What the whole task may spend, counted from construction.
  readonly totalMs: number;
  // The most one command may take of it.
  readonly commandMs: number;
}

// A command is told at least this much less than it is lent, so it answers before it is ended.
const ANSWER_MS = 1000;

export class DeadlineProcess implements Process {
  private readonly deadline: number;
  constructor(
    private readonly process: Process,
    private readonly budget: DeadlineBudget,
  ) {
    this.deadline = performance.now() + budget.totalMs;
  }
  which(binary: string, options?: Pick<RunOptions, 'cwd' | 'env'>): Promise<string | undefined> {
    return this.process.which(binary, options);
  }
  async run(vector: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    const { commandMs } = this.budget;
    const lentMs = Math.max(
      1,
      Math.min(options.timeoutMs ?? commandMs, commandMs, this.deadline - performance.now()),
    );
    const told = options.deadline === undefined ? vector : tell(vector, options.deadline, lentMs);
    return this.process.run(told, {
      ...options,
      interactive: false,
      timeoutMs: lentMs,
      env: { ...options.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    });
  }
}

// The flag goes before an end-of-options separator, where the command still reads flags.
function tell(vector: readonly string[], deadline: CommandDeadline, lentMs: number): string[] {
  const seconds = Math.floor((lentMs - ANSWER_MS) / 1000);
  if (seconds * 1000 < deadline.minimumMs) throw shortOf(vector, lentMs, deadline);
  const separator = vector.indexOf('--');
  const at = separator < 0 ? vector.length : separator;
  return [...vector.slice(0, at), deadline.flag, `${seconds}s`, ...vector.slice(at)];
}

function shortOf(
  vector: readonly string[],
  lentMs: number,
  deadline: CommandDeadline,
): DevkitError {
  const needs = Math.ceil((deadline.minimumMs + ANSWER_MS) / 1000);
  return new DevkitError(
    'internal',
    'PROCESS_TIMEOUT',
    `${vector[0] ?? ''} was not started with ${Math.floor(lentMs / 1000)}s of the run left`,
    {
      hint: `It needs ${needs}s to answer, so the run left it unasked rather than end it early.`,
      nextSteps: [`Run \`${vector.join(' ')}\` by hand to see its answer.`],
    },
  );
}
