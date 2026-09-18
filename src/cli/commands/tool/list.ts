import { ToolList, TOOL_COLUMNS } from '../../../application/tool/list.js';
import { FxCommand } from '../../base.js';

export default class ToolListCommand extends FxCommand {
  static override description =
    'List the companion tools the workspace expects, and where each entry comes from';
  static override examples = ['<%= config.bin %> tool list'];
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(ToolListCommand);
    const { tools } = await this.toolchain();
    this.renderer.list(new ToolList().execute({ tools }), { columns: TOOL_COLUMNS });
  }
}
