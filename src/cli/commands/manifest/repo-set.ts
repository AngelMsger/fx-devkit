import { SetRepoField } from '../../../application/manifest/set.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';

export default class ManifestRepoSet extends FxCommand {
  static override description =
    'Set a scalar field or aka array of a repository in workspace.yaml, touching nothing else';
  static override examples = [
    '<%= config.bin %> manifest repo-set fx-example-api branch feature/x --dry-run',
    '<%= config.bin %> manifest repo-set fx-example-api desc "Backend monolith"',
    '<%= config.bin %> manifest repo-set fx-example-api aka \'["backend", "app-builder"]\' --dry-run',
  ];
  static override args = {
    repo: requiredArgument('repository name'),
    field: requiredArgument('path, desc, branch, project, upstream or aka'),
    value: requiredArgument('new scalar value, or a JSON/YAML string array for aka'),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ManifestRepoSet);
    const dir = await this.manifestDir();
    const result = await new SetRepoField(this.container.fs, this.container.bundledTools).execute({
      dir,
      cliVersion: this.config.version,
      repo: args.repo,
      field: args.field,
      value: args.value,
      ...writeIntent(flags, this.posture),
    });
    this.renderer.record(result);
  }
}
