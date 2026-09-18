import { editEnvScope } from '../../../application/env/scope.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';

export default class EnvPickCommand extends FxCommand {
  static override description =
    'Add shared environments to the current selection; already-all is unchanged. Use env select to replace it.';
  static override examples = ['<%= config.bin %> env pick dev test'];
  static override strict = false;
  static override args = {
    name: requiredArgument('environment name(s)'),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(EnvPickCommand);
    const result = await editEnvScope(
      await this.workspaceDeps(),
      { names: argv as string[], ...writeIntent(flags, this.posture) },
      'pick',
    );
    this.renderer.record(result);
  }
}
