import { Args } from '@oclif/core';

import { editEnvScope } from '../../../application/env/scope.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class EnvPickCommand extends FxCommand {
  static override description =
    'Add shared environments to the current selection; already-all is unchanged. Use env select to replace it.';
  static override examples = ['<%= config.bin %> env pick dev test'];
  static override strict = false;
  static override args = {
    name: Args.string({ ignoreStdin: true, required: true, description: 'environment name(s)' }),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(EnvPickCommand);
    const result = await editEnvScope(
      await this.workspaceDeps(),
      { names: argv as string[], dryRun: flags['dry-run'], posture: this.posture },
      'pick',
    );
    this.renderer.record(result);
  }
}
