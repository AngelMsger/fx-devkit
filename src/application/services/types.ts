// What preparing one declared service reports back: the same row whether the
// work was a native command or an owned workspace file.

import type { ErrorEnvelope } from '../../domain/errors.js';
import type { PreparationAction } from '../../domain/preparation.js';

export interface ServiceResult {
  readonly id: string;
  readonly tool: string;
  readonly env: string | null;
  readonly status: 'unchanged' | 'configured' | 'planned' | 'blocked' | 'failed';
  readonly detail: string;
  readonly changes?: Readonly<Record<string, unknown>>;
  readonly failure?: ErrorEnvelope['error'];
  readonly next_steps?: readonly string[];
  readonly actions?: readonly PreparationAction[];
}

// The part a preparation decides; the caller owns the row's identity.
export type ServiceOutcome = Omit<ServiceResult, 'id' | 'tool' | 'env'>;
