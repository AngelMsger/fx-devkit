// `--fields` projection. It only shapes what is printed; nothing upstream
// (queries, pagination) knows it exists.

export function parseFields(flag: string | undefined): string[] | undefined {
  const fields = (flag ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  return fields.length > 0 ? fields : undefined;
}

export function project(value: unknown, fields: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => project(item, fields));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const found = lookup(value, field.split('.'));
    if (found.present) out[field] = found.value;
  }
  return out;
}

type Lookup = { readonly present: true; readonly value: unknown } | { readonly present: false };

function lookup(value: unknown, path: readonly string[]): Lookup {
  const [head, ...rest] = path;
  if (head === undefined) return { present: true, value };
  if (Array.isArray(value)) {
    if (value.length === 0) return { present: true, value: [] };
    const found = value.map((item) => lookup(item, path));
    if (!found.some((item) => item.present)) return { present: false };
    return {
      present: true,
      value: found.map((item) => (item.present ? item.value : null)),
    };
  }
  if (!isRecord(value) || !(head in value)) return { present: false };
  return lookup(value[head], rest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
