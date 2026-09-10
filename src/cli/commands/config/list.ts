import { ListConfig } from '../../../application/config/list.js';
import { FxCommand } from '../../base.js';
import { configFlagValues } from '../../config-flags.js';

export default class ConfigList extends FxCommand {
  static override description = 'List every config key with its effective value and source';
  static override examples = [
    '<%= config.bin %> config list',
    '<%= config.bin %> config list --format json',
  ];
  static override flags = {};

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigList);
    const items = await new ListConfig(this.container.config).execute({
      env: process.env,
      flags: configFlagValues({ flags, argv: this.argv }),
    });
    this.renderer.list(items, { columns: ['key', 'value', 'source', 'env', 'desc'] });
  }
}
