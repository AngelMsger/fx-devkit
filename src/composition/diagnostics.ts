// A command-scoped diagnostic channel lets composition wire producers before
// CLI initialization has resolved whether verbose output is enabled.

import type { DiagnosticEvent, DiagnosticReporter } from '../ports/diagnostics.js';
import type { Process, ProcessDiagnosticContext, RunOptions } from '../ports/process.js';

export class DiagnosticChannel implements DiagnosticReporter {
  private sink: DiagnosticReporter | undefined;

  connect(sink: DiagnosticReporter): void {
    this.sink = sink;
  }

  emit(event: DiagnosticEvent): void {
    this.sink?.emit(event);
  }
}

export function processWithContext(process: Process, context: ProcessDiagnosticContext): Process {
  return {
    run: (vector: readonly string[], options: RunOptions = {}) =>
      process.run(vector, {
        ...options,
        diagnostic: { ...context, ...options.diagnostic },
      }),
    which: (binary: string) => process.which(binary),
  };
}
