import { AGENT_COLUMNS, AgentList } from '../../../application/agent/list.js';
import { FxCommand } from '../../base.js';

export default class AgentListCommand extends FxCommand {
  static override description =
    'List the coding agents fx knows: detected on this machine, enabled, and where their Skills live';
  static override examples = ['<%= config.bin %> agent list'];
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(AgentListCommand);
    const rows = await new AgentList(this.container.agents).execute({
      configured: this.configAgents,
    });
    this.renderer.list(rows, {
      columns: AGENT_COLUMNS,
    });
  }
}
