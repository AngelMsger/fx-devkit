// Process diagnostics decorate the one subprocess port, preserving its result
// while emitting a bounded, credential-free account of each completed call.

import { redactText, redactVector, summarizeDiagnostic } from '../../domain/diagnostics.js';
import type { DiagnosticEvent, DiagnosticReporter } from '../../ports/diagnostics.js';
import type { Process, ProcessResult, RunOptions } from '../../ports/process.js';

export class DiagnosticProcess implements Process {
  constructor(
    private readonly inner: Process,
    private readonly diagnostics: DiagnosticReporter,
  ) {}

  async run(vector: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
    try {
      const result = await this.inner.run(vector, options);
      this.diagnostics.emit(eventOf(vector, options, result));
      return result;
    } catch (err) {
      const stderr = options.sensitiveOutput
        ? undefined
        : summarizeDiagnostic(err instanceof Error ? err.message : String(err));
      this.diagnostics.emit({
        ...baseEvent(vector, options),
        ...(stderr === undefined ? {} : { stderr }),
      });
      throw err;
    }
  }

  which(binary: string, options?: Pick<RunOptions, 'cwd' | 'env'>): Promise<string | undefined> {
    return this.inner.which(binary, options);
  }
}

function eventOf(
  vector: readonly string[],
  options: RunOptions,
  result: ProcessResult,
): DiagnosticEvent {
  const stderr = options.sensitiveOutput ? undefined : summarizeDiagnostic(result.stderr);
  return {
    ...baseEvent(vector, options),
    exit_code: result.code,
    ...(stderr === undefined ? {} : { stderr }),
  };
}

function baseEvent(vector: readonly string[], options: RunOptions): DiagnosticEvent {
  const context = options.diagnostic;
  return {
    kind: 'process',
    phase: redactText(context?.phase ?? 'subprocess'),
    vector: redactVector(vector),
    ...(options.cwd === undefined ? {} : { cwd: redactText(options.cwd) }),
    ...(options.timeoutMs === undefined ? {} : { timeout_ms: options.timeoutMs }),
    ...(context?.capability === undefined ? {} : { capability: context.capability }),
    ...(context?.provider === undefined ? {} : { provider: context.provider }),
    ...(context?.binding === undefined ? {} : { binding: context.binding }),
  };
}
