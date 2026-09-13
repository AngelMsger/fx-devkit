import { Args } from '@oclif/core';

import { SetConfig } from '../../../application/config/set.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class ConfigSet extends FxCommand {
  static override description = 'Set a config key in ~/.fx/config.yaml';
  static override examples = [
    '<%= config.bin %> config set format json',
    '<%= config.bin %> config set read_only true --dry-run',
  ];
  static override args = {
    key: Args.string({ ignoreStdin: true, required: true, description: 'config key' }),
    value: Args.string({
      ignoreStdin: true,
      required: true,
      description: 'new value; lists are comma-separated',
    }),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigSet);
    const result = await new SetConfig(this.container.config).execute({
      key: args.key,
      value: args.value,
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    this.renderer.record(result);
  }
}
