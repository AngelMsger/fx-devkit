import { Flags } from '@oclif/core';

import { GetConfig } from '../../../application/config/get.js';
import { findKey } from '../../../application/config/resolve.js';
import { FxCommand } from '../../base.js';
import { configFlagValues } from '../../config-flags.js';
import { requiredArgument } from '../../flags.js';

export default class ConfigGet extends FxCommand {
  static override description = 'Show the effective value of a config key and where it comes from';
  static override examples = ['<%= config.bin %> config get format --explain'];
  static override args = {
    key: requiredArgument('config key'),
  };
  static override flags = {
    explain: Flags.boolean({
      default: false,
      description: 'show every layer, not only the winner',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigGet);
    const flagLayer = configFlagValues({ flags, argv: this.argv })[findKey(args.key).name];
    const result = await new GetConfig(this.container.config).execute({
      key: args.key,
      flag: flagLayer,
      env: process.env,
      explain: flags.explain,
    });
    this.renderer.record(result);
  }
}
