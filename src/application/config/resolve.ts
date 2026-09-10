// Layered resolution of one setting: flag > env > file > default. Every layer is
// reported, not just the winner, so `--explain` can show why a value is what it is.

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import type { ConfigFile } from '../../ports/stores.js';

import { KEYS, type Key } from './keys.js';
import { spellValue, storedValue } from './values.js';

export type LayerSource = 'flag' | 'env' | 'file' | 'default';

export interface Layer {
  readonly source: LayerSource;
  readonly value: string | undefined;
  readonly origin: string;
}

export interface Resolved {
  readonly key: Key;
  readonly value: string | undefined;
  readonly source: LayerSource;
  readonly layers: readonly Layer[];
}

export interface ResolveInput {
  readonly flag?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly file: ConfigFile;
}

export function findKey(name: string): Key {
  const key = KEYS.find((k) => k.name === name);
  if (key !== undefined) return key;
  const suggestion = nearest(
    name,
    KEYS.map((k) => k.name),
  );
  const hint =
    suggestion === undefined
      ? `Known keys: ${KEYS.map((k) => k.name).join(', ')}.`
      : `Did you mean "${suggestion}"?`;
  throw new DevkitError('usage', 'CONFIG_KEY_UNKNOWN', `unknown config key "${name}"`, {
    hint,
    nextSteps: ['fx config list'],
  });
}

export function resolveKey(name: string, input: ResolveInput): Resolved {
  const key = findKey(name);
  const layers: Layer[] = [
    ...(key.flag === undefined
      ? []
      : [{ source: 'flag' as const, value: input.flag, origin: `--${key.flag}` }]),
    { source: 'env', value: input.env[key.env], origin: key.env },
    { source: 'file', value: spellValue(storedValue(input.file, key)), origin: 'config.yaml' },
    { source: 'default', value: key.default, origin: 'built-in' },
  ];
  const active = layers.find((l) => l.value !== undefined) ?? layers[layers.length - 1];
  return { key, value: active?.value, source: active?.source ?? 'default', layers };
}
