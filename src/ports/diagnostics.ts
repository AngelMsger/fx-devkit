// Structured diagnostic events cross layer boundaries through this port;
// producers know neither output format nor whether verbose output is enabled.

import type { DiagnosticEvent } from '../domain/diagnostics.js';

export type { DiagnosticEvent } from '../domain/diagnostics.js';

export interface DiagnosticReporter {
  emit(event: DiagnosticEvent): void;
}
