import { Args } from '@oclif/core';

import { inspectMcp } from '../../../composition/harness.js';
import { FxCommand } from '../../base.js';

export default class McpShowCommand extends FxCommand {
  static override description = 'Show one MCP declaration, environment references and readiness';
  static override examples = ['<%= config.bin %> mcp show knowledge --format json'];
  static override args = {
    name: Args.string({ required: true, description: 'declared MCP resource name' }),
  };
  async run(): Promise<void> {
    const { args } = await this.parse(McpShowCommand);
    const result = await inspectMcp({ ...this.harnessInput(), name: args.name });
    this.renderer.record(result.items[0]!);
  }
}
