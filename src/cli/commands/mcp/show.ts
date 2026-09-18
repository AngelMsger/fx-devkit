import { inspectMcp } from '../../../composition/harness.js';
import { FxCommand } from '../../base.js';
import { requiredArgument } from '../../flags.js';

export default class McpShowCommand extends FxCommand {
  static override description = 'Show one MCP declaration, environment references and readiness';
  static override examples = ['<%= config.bin %> mcp show knowledge --format json'];
  static override args = {
    name: requiredArgument('declared MCP resource name'),
  };
  async run(): Promise<void> {
    const { args } = await this.parse(McpShowCommand);
    const result = await inspectMcp({ ...this.harnessInput(), name: args.name });
    this.renderer.record(result.items[0]!);
  }
}
