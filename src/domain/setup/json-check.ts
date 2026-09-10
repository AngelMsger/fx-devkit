// Status commands can exit successfully while reporting an unusable state.
// Only the declared scalar is compared; response contents never become diagnostics.

import type { JsonExpectation } from './types.js';

export function matchesJson(text: string, expectation: JsonExpectation): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  for (const part of expectation.path.split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, part)) return false;
    value = (value as Record<string, unknown>)[part];
  }
  return value === expectation.equals;
}
