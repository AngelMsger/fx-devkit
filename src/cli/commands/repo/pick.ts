import { editRepoScope } from '../../../application/repo/scope.js';
import { dryRunFlag, requiredArgument } from '../../flags.js';
import type { WriteScopeDeclaration } from '../../workspace-write-policy.js';
import { SelectionCommand } from '../selection.js';

export default class RepoPickCommand extends SelectionCommand {
  static override description =
    'Add shared repositories to the current selection; already-all is unchanged. Use repo select to replace it.';
  static override examples = ['<%= config.bin %> repo pick fx-example-api fx-example-auth'];
  static override strict = false;
  static override args = {
    name: requiredArgument('repository name(s)'),
  };
  static override flags = { 'dry-run': dryRunFlag };
  static override writeScope: WriteScopeDeclaration = 'workspace';

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(RepoPickCommand);
    await this.editSelection(editRepoScope, 'pick', argv, flags);
  }
}
