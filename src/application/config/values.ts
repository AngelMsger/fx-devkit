// Conversion between a key's stored shape and the single string a person
// types or reads. Both directions live together so they cannot drift.

import { DevkitError } from '../../domain/errors.js';
import { parseBoolean, parseList } from '../../domain/values.js';
import type { ConfigFile } from '../../ports/stores.js';

import type { Key } from './keys.js';

export type StoredValue = string | boolean | readonly string[];

export function parseValue(key: Key, text: string): StoredValue {
  switch (key.kind) {
    case 'string':
      return text;
    case 'enum':
      if (key.options?.includes(text)) return text;
      throw invalid(key, text, `one of ${key.options?.join(', ')}`);
    case 'list':
      return parseList(text) ?? [];
    case 'bool': {
      const parsed = parseBoolean(text);
      if (parsed !== undefined) return parsed;
      throw invalid(key, text, 'true or false');
    }
  }
}

export function spellValue(value: StoredValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

export function storedValue(file: ConfigFile, key: Key): StoredValue | undefined {
  return file[key.name];
}

function invalid(key: Key, text: string, expected: string): DevkitError {
  return new DevkitError(
    'usage',
    'CONFIG_VALUE_INVALID',
    `"${text}" is not a valid value for ${key.name}: expected ${expected}`,
    { hint: key.desc, nextSteps: ['fx config list'] },
  );
}
