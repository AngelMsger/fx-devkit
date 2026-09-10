import { Args } from '@oclif/core';

import { ToolShow } from '../../../application/tool/show.js';
import { toolDependants } from '../../../composition/container.js';
import { FxCommand } from '../../base.js';

export default class ToolShowCommand extends FxCommand {
  static override description =
    'Show one tool: its resolved entry, where each field comes from, who depends on it';
  static override examples = ['<%= config.bin %> tool show bitbucket-cli'];
  static override args = { tool: Args.string({ required: true, description: 'tool name' }) };
  static override flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(ToolShowCommand);
    const { tools } = await this.toolchain();
    this.renderer.record(
      new ToolShow().execute({ tools, name: args.tool, dependants: toolDependants() }),
    );
  }
}
