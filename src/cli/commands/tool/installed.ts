import { toolInventory } from '../../../composition/tool-inventory.js';
import { FxCommand } from '../../base.js';

export default class ToolInstalledCommand extends FxCommand {
  static override description =
    'Compare recorded installations with all registered manifests and suggest packages to review for manual removal';
  static override examples = ['<%= config.bin %> tool installed --format json'];
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(ToolInstalledCommand);
    this.renderer.list(await toolInventory(this.container, this.config.version).execute(), {
      columns: ['name', 'via', 'spec', 'state', 'required_by', 'uninstall_hint'],
    });
  }
}
