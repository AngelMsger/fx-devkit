import { inspectMcp } from '../../../composition/harness.js';
import { FxCommand } from '../../base.js';

export default class McpListCommand extends FxCommand {
  static override description = 'List workspace MCP resources, projections and readiness';
  static override examples = ['<%= config.bin %> mcp list --format json'];
  async run(): Promise<void> {
    await this.parse(McpListCommand);
    const result = await inspectMcp(this.harnessInput());
    const rows =
      this.format === 'human'
        ? result.items.map((item) => ({
            name: item.name,
            transport: item.transport,
            status: item.readiness.status,
          }))
        : result.items;
    this.renderer.list(rows, { trailer: { orphaned: result.orphaned } });
  }
}
