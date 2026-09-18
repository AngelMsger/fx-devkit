import { AgentPick } from '../../../application/agent/pick.js';
import { agentResourceCleanup } from '../../../composition/agent-cleanup.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';

export default class AgentUnpickCommand extends FxCommand {
  static override description =
    'Deselect coding agents and reconcile owned resources across workspaces in this FX_HOME';
  static override examples = ['<%= config.bin %> agent unpick claude-code codex'];
  static override strict = false;
  static override args = {
    id: requiredArgument('agent id(s), e.g. claude-code'),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AgentUnpickCommand);
    const result = await new AgentPick(
      this.container.config,
      this.container.agents,
      agentResourceCleanup(this.harnessInput()),
    ).execute({
      ids: argv as string[],
      action: 'unpick',
      ...writeIntent(flags, this.posture),
    });
    this.renderer.record(result);
  }
}
