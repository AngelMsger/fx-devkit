// A lifecycle worker lends every companion command the remaining task budget.
// The underlying process adapter retains responsibility for cancellation.

import type { Process, ProcessResult, RunOptions } from '../../ports/process.js';

export class DeadlineProcess implements Process {
  private readonly deadline = performance.now() + 29000;
  constructor(private readonly process: Process) {}
  which(binary: string, options?: Pick<RunOptions, 'cwd' | 'env'>): Promise<string | undefined> {
    return this.process.which(binary, options);
  }
  run(vector: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    return this.process.run(vector, {
      ...options,
      interactive: false,
      timeoutMs: Math.max(
        1,
        Math.min(options.timeoutMs ?? 15000, 15000, this.deadline - performance.now()),
      ),
      env: { ...options.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    });
  }
}
