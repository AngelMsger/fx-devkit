// Writing the profile: the config file and every registered workspace's
// personal layer, as one document stamped with the profile version.

import { renderProfile } from '../../domain/config/codec.js';
import { configFileSchema } from '../../domain/config/file.js';
import { PROFILE_VERSION, type Profile } from '../../domain/config/profile.js';
import type { Clock } from '../../ports/clock.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ConfigStore, LocalLayerStore } from '../../ports/stores.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

export interface ConfigExportDeps {
  readonly config: ConfigStore;
  readonly localStore: LocalLayerStore;
  readonly clock: Clock;
  readonly fs: FileSystem;
}

export type ConfigExportInput =
  | { readonly out?: undefined }
  | {
      readonly out: string;
      readonly dryRun: boolean;
      readonly posture: WritePosture;
    };

export interface ConfigExportOutput {
  readonly profile: Profile;
  readonly text: string;
  readonly path: string | null;
  readonly written: boolean;
}

export class ConfigExport {
  constructor(private readonly deps: ConfigExportDeps) {}

  async execute(input: ConfigExportInput = {}): Promise<ConfigExportOutput> {
    const file = await this.deps.config.read();
    const workspaces: Profile['workspaces'] = {};
    for (const name of Object.keys(file.workspaces ?? {}))
      workspaces[name] = await this.deps.localStore.read(name);
    const profile: Profile = {
      fx_profile: PROFILE_VERSION,
      exported_at: this.deps.clock.now().toISOString(),
      // Unknown keys of config.yaml stay behind: only what the schema names travels.
      config: configFileSchema.parse(file),
      workspaces,
    };
    const text = renderProfile(profile);
    const output = { profile, text, path: input.out ?? null, written: false };
    if (input.out === undefined || input.dryRun) return output;
    assertWritable(input.posture, `config export ${input.out}`);
    await this.deps.fs.writeText(input.out, text);
    return { ...output, written: true };
  }
}
