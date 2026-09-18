// Every setting with its effective value, walked from the key registry so a new
// key appears here without being added.

import type { ConfigStore } from '../../ports/stores.js';

import { KEYS, type KeyKind, type KeyName } from './keys.js';
import { resolveKey, type LayerSource } from './resolve.js';

export interface ListConfigInput {
  readonly env: NodeJS.ProcessEnv;
  readonly flags?: Readonly<Partial<Record<KeyName, string>>>;
}

export interface ConfigEntry {
  readonly key: string;
  readonly value: string | null;
  readonly source: LayerSource;
  readonly env: string;
  readonly kind: KeyKind;
  readonly desc: string;
}

export const CONFIG_COLUMNS = ['key', 'value', 'source', 'env', 'desc'] as const;

export class ListConfig {
  constructor(private readonly store: ConfigStore) {}

  async execute(input: ListConfigInput): Promise<ConfigEntry[]> {
    const file = await this.store.read();
    return KEYS.map((key) => {
      const resolved = resolveKey(key.name, {
        env: input.env,
        file,
        flag: input.flags?.[key.name],
      });
      return {
        key: key.name,
        value: resolved.value ?? null,
        source: resolved.source,
        env: key.env,
        kind: key.kind,
        desc: key.desc,
      };
    });
  }
}
