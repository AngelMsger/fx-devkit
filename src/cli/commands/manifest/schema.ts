import { Flags } from '@oclif/core';

import { SchemaManifest } from '../../../application/manifest/explain.js';
import { KINDS, type Kind } from '../../../domain/manifest/types.js';
import { FxCommand } from '../../base.js';

export default class ManifestSchema extends FxCommand {
  static override description =
    'Print the JSON Schema of a manifest document; always JSON, whatever --format says';
  static override examples = ['<%= config.bin %> manifest schema --kind tools > tools.schema.json'];
  static override flags = {
    kind: Flags.string({
      options: [...KINDS],
      default: 'workspace',
      description: 'which document',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ManifestSchema);
    const schema = new SchemaManifest().execute({
      kind: flags.kind as Kind,
      cliVersion: this.config.version,
    });
    process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
  }
}
