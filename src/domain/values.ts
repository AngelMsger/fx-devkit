// Reading values whose shape is not known in advance: the scalar spellings people
// type on a command line or in an environment variable, a decoded document, a
// thrown value. Anything else is a validation error for the caller.

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);

export function parseBoolean(text: string | undefined): boolean | undefined {
  const normalized = text?.trim().toLowerCase();
  if (normalized === undefined || normalized === '') return undefined;
  if (TRUE.has(normalized)) return true;
  if (FALSE.has(normalized)) return false;
  return undefined;
}

export function parseList(text: string | undefined): string[] | undefined {
  if (text === undefined) return undefined;
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

// Keys appear in the order their first item does.
export function countBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
