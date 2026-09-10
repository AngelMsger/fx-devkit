// Applying a profile written by `config export`, reporting for each workspace
// layer whether the write created it, changed it or left it alone.

import { parseProfile } from '../../domain/config/codec.js';
import type { Profile } from '../../domain/config/profile.js';
import type { LocalLayer } from '../../domain/manifest/types.js';
import type { ConfigFile, ConfigStore, LocalLayerStore } from '../../ports/stores.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

export interface ConfigImportDeps {
  readonly config: ConfigStore;
  readonly localStore: LocalLayerStore;
}

export interface ConfigImportInput {
  readonly text: string;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

type LayerAction = 'created' | 'updated' | 'unchanged';

export interface ConfigImportOutput {
  readonly config: 'changed' | 'unchanged';
  readonly workspaces: readonly { name: string; action: LayerAction }[];
  readonly next_steps: readonly string[];
  readonly written: boolean;
}

export class ConfigImport {
  constructor(private readonly deps: ConfigImportDeps) {}

  async execute(input: ConfigImportInput): Promise<ConfigImportOutput> {
    const profile = parseProfile(input.text);
    const current = await this.deps.config.read();
    // Keys the profile names win; keys it does not mention stay as they are.
    const merged: ConfigFile = { ...current, ...named(profile.config) };
    const workspaces: { name: string; action: LayerAction }[] = [];
    for (const [name, layer] of Object.entries(profile.workspaces)) {
      workspaces.push({ name, action: actionFor(await this.deps.localStore.read(name), layer) });
    }
    const output: ConfigImportOutput = {
      config: same(current, merged) ? 'unchanged' : 'changed',
      workspaces,
      next_steps: Object.entries(profile.config.workspaces ?? {}).map(([name, entry]) =>
        entry.source === undefined
          ? `fx init ${entry.root} --name ${name} --from <source>`
          : `fx init ${entry.root} --name ${name} --from ${entry.source}`,
      ),
      written: false,
    };
    const nothing =
      output.config === 'unchanged' && workspaces.every((w) => w.action === 'unchanged');
    if (input.dryRun || nothing) return output;
    assertWritable(input.posture, 'profile import');
    if (output.config === 'changed') await this.deps.config.write(merged);
    for (const [name, layer] of Object.entries(profile.workspaces)) {
      if (workspaces.find((w) => w.name === name)?.action !== 'unchanged')
        await this.deps.localStore.write(name, layer);
    }
    return { ...output, written: true };
  }
}

function actionFor(existing: LocalLayer, next: LocalLayer): LayerAction {
  if (same(existing, next)) return 'unchanged';
  return Object.keys(existing).length === 0 ? 'created' : 'updated';
}

// zod types an optional as `T | undefined`; only keys with a value are merged.
function named(config: Profile['config']): Partial<ConfigFile> {
  return Object.fromEntries(
    Object.entries(config).filter(([, v]) => v !== undefined),
  ) as Partial<ConfigFile>;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
