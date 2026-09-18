import { editRepoScope } from '../../../application/repo/scope.js';
import { dryRunFlag, requiredArgument } from '../../flags.js';
import { SelectionCommand } from '../selection.js';

export default class RepoUnpickCommand extends SelectionCommand {
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
    await this.editSelection(editRepoScope, 'unpick', argv, flags);
  }
}
