import { editEnvScope } from '../../../application/env/scope.js';
import { selectOperation } from '../../../application/workspace/scope.js';
import { argument } from '../../flags.js';
import type { WriteScopeDeclaration } from '../../workspace-write-policy.js';
import { SelectionCommand, selectFlags } from '../selection.js';

export default class EnvSelectCommand extends SelectionCommand {
  static override description =
    'Replace the shared environment selection; --all follows current and future declarations, --none selects none. This changes selection only; it does not perform login or setup.';
  static override examples = [
    '<%= config.bin %> env select dev',
    '<%= config.bin %> env select --all',
  ];
  static override strict = false;
  static override args = {
    name: argument('names to select exclusively'),
  };
  static override flags = selectFlags('environments');
  static override writeScope: WriteScopeDeclaration = 'workspace';

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(EnvSelectCommand);
    await this.editSelection(editEnvScope, selectOperation(flags.all, flags.none), argv, flags);
  }
}
