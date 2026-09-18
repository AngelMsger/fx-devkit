import { editRepoScope } from '../../../application/repo/scope.js';
import { selectOperation } from '../../../application/workspace/scope.js';
import { argument } from '../../flags.js';
import { SelectionCommand, selectFlags } from '../selection.js';

export default class RepoSelectCommand extends SelectionCommand {
  static override description =
    'Replace the shared repository selection; --all follows current and future declarations, --none selects none. Run fx sync afterward to prepare selected repositories; existing checkouts are preserved.';
  static override examples = [
    '<%= config.bin %> repo select api web',
    '<%= config.bin %> repo select --all',
  ];
  static override strict = false;
  static override args = {
    name: argument('names to select exclusively'),
  };
  static override flags = selectFlags('repositories');

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(RepoSelectCommand);
    await this.editSelection(editRepoScope, selectOperation(flags.all, flags.none), argv, flags);
  }
}
