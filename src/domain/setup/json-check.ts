// Status commands can exit successfully while reporting an unusable state.
// Only the declared scalar is compared, and only a declared reason field is ever quoted;
// nothing else in a response becomes a diagnostic.

import type { JsonExpectation } from './types.js';

export function matchesJson(text: string, expectation: JsonExpectation): boolean {
  return valueAt(text, expectation.path) === expectation.equals;
}

export function statedReason(text: string, expectation: JsonExpectation): string | undefined {
  if (expectation.reason === undefined) return undefined;
  const reason = valueAt(text, expectation.reason);
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : undefined;
}

// `undefined` stands for an unreadable response as well as an absent field.
function valueAt(text: string, path: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  for (const part of path.split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, part))
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
