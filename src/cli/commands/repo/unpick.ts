import { editRepoScope } from '../../../application/repo/scope.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';

export default class RepoUnpickCommand extends FxCommand {
  static override description =
    'Stop tracking shared repositories on this machine; nothing on disk changes';
  static override examples = ['<%= config.bin %> repo unpick fx-example-docs'];
  static override strict = false;
  static override args = {
    name: requiredArgument('repository name(s)'),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(RepoUnpickCommand);
    const result = await editRepoScope(
      await this.workspaceDeps(),
      { names: argv as string[], ...writeIntent(flags, this.posture) },
      'unpick',
    );
    this.renderer.record(result);
  }
}
