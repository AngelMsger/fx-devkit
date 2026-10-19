// Stage selection is validated against the registered stage names. Keeping
// selection independent of execution lets previews reject typos before IO.

import { DevkitError } from './errors.js';
import { nearest, suggestionHint } from './fuzzy.js';

export function selectSyncStages(
  value: string | undefined,
  available: readonly string[],
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const selected = [...new Set(value.split(',').map((part) => part.trim()))];
  const unknown = selected.find((id) => !available.includes(id));
  if (unknown !== undefined) {
    const suggestion = nearest(unknown, available);
    throw new DevkitError('usage', 'SYNC_STAGE_UNKNOWN', `Unknown sync stage "${unknown}"`, {
      hint: suggestionHint(suggestion, `Choose from ${available.join(', ')}.`),
      nextSteps: ['fx sync --help'],
    });
  }
  return selected;
}
