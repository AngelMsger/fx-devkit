import { Args } from '@oclif/core';

import { editEnvScope } from '../../../application/env/scope.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class EnvUnpickCommand extends FxCommand {
  static override description = "Drop environments from this machine's scope";
  static override examples = ['<%= config.bin %> env unpick selfhosted'];
  static override strict = false;
  static override args = {
    name: Args.string({ ignoreStdin: true, required: true, description: 'environment name(s)' }),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(EnvUnpickCommand);
    const result = await editEnvScope(
      await this.workspaceDeps(),
      { names: argv as string[], dryRun: flags['dry-run'], posture: this.posture },
      'unpick',
    );
    this.renderer.record(result);
  }
}
