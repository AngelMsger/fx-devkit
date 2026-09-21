import { UnsetConfig } from '../../../application/config/unset.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';

export default class ConfigUnset extends FxCommand {
  static override description = 'Remove a config key from ~/.fx/config.yaml';
  static override examples = ['<%= config.bin %> config unset format'];
  static override args = {
    key: requiredArgument('config key'),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigUnset);
    const result = await new UnsetConfig(this.container.config).execute({
      key: args.key,
      ...writeIntent(flags, this.posture),
    });
    this.renderer.record(result);
  }
}
