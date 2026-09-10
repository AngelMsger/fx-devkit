// Parsing of the scalar spellings people type on a command line or in an
// environment variable. Anything else is a validation error for the caller.

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
  const items = (text ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}
