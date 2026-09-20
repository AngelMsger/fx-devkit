import { editEnvScope } from '../../../application/env/scope.js';
import { dryRunFlag, requiredArgument } from '../../flags.js';
import { SelectionCommand } from '../selection.js';

export default class EnvUnpickCommand extends SelectionCommand {
  static override description = "Drop environments from this machine's scope";
  static override examples = ['<%= config.bin %> env unpick selfhosted'];
  static override strict = false;
  static override args = {
    name: requiredArgument('environment name(s)'),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(EnvUnpickCommand);
    await this.editSelection(editEnvScope, 'unpick', argv, flags);
  }
}
