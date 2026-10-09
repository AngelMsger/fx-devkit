// Every subprocess fx starts is something it waits on, so the one subprocess port is
// where a watcher learns what that is. A child that owns the terminal is handed it, and
// one that merely stays in fx's terminal session is known to be able to ask there.

import path from 'node:path';

import { redactText } from '../../domain/diagnostics.js';
import type { Activity } from '../../ports/activity.js';
import type { Process, ProcessResult, RunOptions } from '../../ports/process.js';

import { leavesSession } from './node-process.js';

export class WatchedProcess implements Process {
  constructor(
    private readonly inner: Process,
    private readonly activity: Activity,
  ) {}

  async run(vector: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    const release =
      options.interactive === true
        ? this.activity.handover()
        : this.activity.waiting({
            label: labelOf(vector, options),
            mayAsk: !leavesSession(options),
          });
    try {
      return await this.inner.run(vector, options);
    } finally {
      release();
    }
  }

  which(binary: string, options?: Pick<RunOptions, 'cwd' | 'env'>): Promise<string | undefined> {
    return this.inner.which(binary, options);
  }
}

// The caller's own name for the call, or the executable alone: arguments may carry
// what must not reach a screen.
function labelOf(vector: readonly string[], options: RunOptions): string {
  const phase = options.diagnostic?.phase;
  return phase === undefined ? path.basename(vector[0] ?? '') : redactText(phase);
}
