import { editEnvScope } from '../../../application/env/scope.js';
import { dryRunFlag, requiredArgument } from '../../flags.js';
import type { WriteScopeDeclaration } from '../../workspace-write-policy.js';
import { SelectionCommand } from '../selection.js';

export default class EnvPickCommand extends SelectionCommand {
  static override description =
    'Add shared environments to the current selection; already-all is unchanged. Use env select to replace it.';
  static override examples = ['<%= config.bin %> env pick dev test'];
  static override strict = false;
  static override args = {
    name: requiredArgument('environment name(s)'),
  };
  static override flags = { 'dry-run': dryRunFlag };
  static override writeScope: WriteScopeDeclaration = 'workspace';

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(EnvPickCommand);
    await this.editSelection(editEnvScope, 'pick', argv, flags);
  }
}
