import { MCP_COLUMNS } from '../../../application/harness/inspect.js';
import { inspectMcp } from '../../../application/harness/session.js';
import { harnessSession } from '../../../composition/harness.js';
import { FxCommand } from '../../base.js';

export default class McpListCommand extends FxCommand {
  static override description = 'List workspace MCP resources, projections and readiness';
  static override examples = ['<%= config.bin %> mcp list --format json'];
  async run(): Promise<void> {
    await this.parse(McpListCommand);
    const result = await inspectMcp(harnessSession(this.harnessInput()));
    this.renderer.list(result.items, {
      columns: MCP_COLUMNS,
      trailer: { orphaned: result.orphaned },
    });
  }
}
