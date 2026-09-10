import { EnvList } from '../../../application/env/list.js';
import { FxCommand } from '../../base.js';

export default class EnvListCommand extends FxCommand {
  static override description =
    'List the environments, their platforms, and which ones this machine picked';
  static override examples = ['<%= config.bin %> env list --format json'];
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(EnvListCommand);
    const rows = new EnvList(await this.workspaceDeps()).execute();
    this.renderer.list(rows, {
      columns: ['name', 'label', 'picked', 'platforms', 'confidence', 'note'],
    });
  }
}
