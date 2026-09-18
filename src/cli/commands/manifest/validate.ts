import { Flags } from '@oclif/core';

import { ValidateManifest, type ValidatedKind } from '../../../application/manifest/validate.js';
import { DevkitError } from '../../../domain/errors.js';
import { FxCommand } from '../../base.js';

const KINDS: ValidatedKind[] = ['workspace', 'environments', 'tools', 'members', 'harness'];

export default class ManifestValidate extends FxCommand {
  static override description =
    'Check every manifest document and report each problem with its path';
  static override examples = ['<%= config.bin %> manifest validate --strict --format json'];
  static override flags = {
    strict: Flags.boolean({ default: false, description: 'treat unknown fields as errors' }),
    kind: Flags.string({ options: KINDS, description: 'check one document only' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ManifestValidate);
    const dir = await this.manifestDir();
    const report = await new ValidateManifest(
      this.container.fs,
      this.container.bundledTools,
    ).execute({
      dir,
      cliVersion: this.config.version,
      providers: this.container.providers,
      strict: flags.strict,
      kind: flags.kind as ValidatedKind | undefined,
    });
    this.renderer.record(report);
    if (report.ok) return;
    const count = report.documents.reduce((n, d) => n + d.problems.length, 0);
    throw new DevkitError(
      'config',
      'MANIFEST_INVALID',
      `${count} problem(s) found; see the report on stdout`,
      {
        hint: '`fx manifest explain <path>` describes any field named above.',
        nextSteps: ['fx manifest explain <path>'],
      },
    );
  }
}
