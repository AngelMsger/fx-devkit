import { toolInventory } from '../../../composition/tool-inventory.js';
import { FxCommand } from '../../base.js';

export default class ToolInstalledCommand extends FxCommand {
  static override description =
    'Inspect known installed tools across this FX_HOME, their installation origin and workspace requirements';
  static override examples = ['<%= config.bin %> tool inventory --format json'];
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(ToolInstalledCommand);
    this.renderer.list(await toolInventory(this.container, this.config.version).execute(), {
      columns: [
        'name',
        'installation_origin',
        'via',
        'spec',
        'state',
        'required_by',
        'uninstall_hint',
      ],
      trailer: { scope: 'global' },
    });
  }
}
