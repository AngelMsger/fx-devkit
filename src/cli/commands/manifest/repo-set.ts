import { editManifestRepo } from '../../../composition/manifest-edit.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';
import type { WriteScopeDeclaration } from '../../workspace-write-policy.js';

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
  static override writeScope: WriteScopeDeclaration = 'source';

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ManifestRepoSet);
    const dir = await this.manifestDir();
    const result = await editManifestRepo(this.container, {
      dir,
      cliVersion: this.config.version,
      providers: this.container.providers,
      repo: args.repo,
      field: args.field,
      value: args.value,
      ...writeIntent(flags, this.posture),
    });
    this.renderer.record(result);
  }
}
