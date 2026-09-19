import { Flags } from '@oclif/core';

import { ToolList, TOOL_COLUMNS } from '../../../application/tool/list.js';
import { FxCommand } from '../../base.js';

export default class ToolListCommand extends FxCommand {
  static override description =
    'List the companion tools the workspace expects, and where each entry comes from';
  static override examples = [
    '<%= config.bin %> tool list',
    '<%= config.bin %> tool list --catalog   # also the tools fx knows but nothing here selects',
  ];
  static override flags = {
    catalog: Flags.boolean({
      description: 'include the tools fx knows that no binding or declaration selects',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ToolListCommand);
    const { tools, all, sources } = await this.toolchain();
    this.renderer.list(new ToolList().execute({ tools: flags.catalog ? all : tools, sources }), {
      columns: TOOL_COLUMNS,
    });
  }
}
