import { Args } from '@oclif/core';

import { SetRepoField } from '../../../application/manifest/set.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class ManifestSet extends FxCommand {
  static override description =
    'Set a scalar field or aka array of a repository in workspace.yaml, touching nothing else';
  static override examples = [
    '<%= config.bin %> manifest set fx-example-api branch feature/x --dry-run',
    '<%= config.bin %> manifest set fx-example-api desc "Backend monolith"',
    '<%= config.bin %> manifest set fx-example-api aka \'["backend", "app-builder"]\' --dry-run',
  ];
  static override args = {
    repo: Args.string({ required: true, description: 'repository name' }),
    field: Args.string({
      required: true,
      description: 'path, desc, branch, project, upstream or aka',
    }),
    value: Args.string({
      required: true,
      description: 'new scalar value, or a JSON/YAML string array for aka',
    }),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ManifestSet);
    const dir = await this.manifestDir();
    const result = await new SetRepoField(this.container.fs, this.container.bundledTools).execute({
      dir,
      cliVersion: this.config.version,
      repo: args.repo,
      field: args.field,
      value: args.value,
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    this.renderer.record(result);
  }
}
