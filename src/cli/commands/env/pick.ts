import { Args } from '@oclif/core';

import { editEnvScope } from '../../../application/env/scope.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class EnvPickCommand extends FxCommand {
  static override description =
    'Select the environments this machine uses; login, doctor and can expand only these';
  static override examples = ['<%= config.bin %> env pick dev test'];
  static override strict = false;
  static override args = {
    name: Args.string({ required: true, description: 'environment name(s)' }),
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
