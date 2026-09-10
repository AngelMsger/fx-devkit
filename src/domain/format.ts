// The three output formats and the default, named once so the flag, the config
// key and the docs generator cannot disagree about them.

export const FORMATS = ['human', 'json', 'ndjson'] as const;
export type Format = (typeof FORMATS)[number];
export const DEFAULT_FORMAT: Format = 'human';

export function isFormat(value: unknown): value is Format {
  return typeof value === 'string' && (FORMATS as readonly string[]).includes(value);
}
