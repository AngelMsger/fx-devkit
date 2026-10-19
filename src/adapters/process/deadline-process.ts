// A lifecycle worker lends every companion command the remaining task budget.
// The underlying process adapter retains responsibility for cancellation.

import type { Process, ProcessResult, RunOptions } from '../../ports/process.js';

export interface DeadlineBudget {
  // What the whole task may spend, counted from construction.
  readonly totalMs: number;
  // The most one command may take of it.
  readonly commandMs: number;
}

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
  run(vector: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    const { commandMs } = this.budget;
    return this.process.run(vector, {
      ...options,
      interactive: false,
      timeoutMs: Math.max(
        1,
        Math.min(options.timeoutMs ?? commandMs, commandMs, this.deadline - performance.now()),
      ),
      env: { ...options.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    });
  }
}
