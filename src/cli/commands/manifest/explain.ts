import { Args, Flags } from '@oclif/core';

import { ExplainManifest } from '../../../application/manifest/explain.js';
import { KINDS, type Kind } from '../../../domain/manifest/types.js';
import { FxCommand } from '../../base.js';

export default class ManifestExplain extends FxCommand {
  static override description =
    'Describe a manifest field: type, whether it is required, what it means';
  static override examples = [
    '<%= config.bin %> manifest explain repos[].obs.overrides',
    '<%= config.bin %> manifest explain --kind tools tools[].setup',
  ];
  static override args = {
    path: Args.string({
      ignoreStdin: true,
      description: 'field path, e.g. repos[].branch; omit for the document root',
    }),
  };
  static override flags = {
    kind: Flags.string({
      options: [...KINDS],
      default: 'workspace',
      description: 'which document',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ManifestExplain);
    this.renderer.record(
      new ExplainManifest().execute({ kind: flags.kind as Kind, path: args.path }),
    );
  }
}
