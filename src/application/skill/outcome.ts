// Each product line records its own per-item outcome before rethrowing, so an
// interrupted stage still says which items were written and which never started.

import { asDevkitError, toEnvelope } from '../../domain/errors.js';

import type { ItemOutcome } from './types.js';
import { skillWriteError } from './write-error.js';

export async function applyItem<T extends ItemOutcome>(
  items: T[],
  index: number,
  apply: () => Promise<void>,
): Promise<void> {
  try {
    await apply();
    items[index] = {
      ...items[index]!,
      status: items[index]!.status === 'skipped' ? 'skipped' : 'done',
    };
  } catch (error) {
    const item = items[index]!;
    const failure =
      'path' in item && typeof item.path === 'string' ? skillWriteError(error, item.path) : error;
    items[index] = {
      ...items[index]!,
      status: 'failed',
      failure: toEnvelope(asDevkitError(failure)).error,
    };
    throw failure;
  }
}
