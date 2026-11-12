// Parse explicit per-repository evidence selectors without silently replacing duplicates.

import { DevkitError } from '../../../domain/errors.js';

export function repoOverrides(
  values: readonly string[] | undefined,
): Readonly<Record<string, string>> | undefined {
  if (values === undefined) return undefined;
  const entries = new Map<string, string>();
  for (const value of values) {
    const separator = value.indexOf('=');
    const name = value.slice(0, separator);
    const selected = value.slice(separator + 1);
    if (separator <= 0 || selected.trim() === '' || entries.has(name))
      throw new DevkitError(
        'usage',
        'RELEASE_OVERRIDE_INVALID',
        'Each override must be a unique repo=value pair',
        {
          nextSteps: ['Repeat the flag once for each selected repository.'],
        },
      );
    entries.set(name, selected);
  }
  return Object.fromEntries(entries);
}
