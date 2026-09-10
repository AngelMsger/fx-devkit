// One setting's effective value and where it comes from. `--explain` adds every
// layer that had a say, not only the winner.

import type { ConfigStore } from '../../ports/stores.js';

import { resolveKey, type LayerSource } from './resolve.js';

export interface ConfigLayer {
  readonly source: LayerSource;
  readonly value: string | null;
  readonly origin: string;
}

export interface GetConfigInput {
  readonly key: string;
  readonly flag?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly explain: boolean;
}

export interface GetConfigOutput {
  readonly key: string;
  readonly value: string | null;
  readonly source: LayerSource;
  readonly layers?: readonly ConfigLayer[];
}

export class GetConfig {
  constructor(private readonly store: ConfigStore) {}

  async execute(input: GetConfigInput): Promise<GetConfigOutput> {
    const file = await this.store.read();
    const resolved = resolveKey(input.key, { flag: input.flag, env: input.env, file });
    const base = { key: resolved.key.name, value: resolved.value ?? null, source: resolved.source };
    return input.explain
      ? {
          ...base,
          layers: resolved.layers.map((layer) => ({ ...layer, value: layer.value ?? null })),
        }
      : base;
  }
}
