import { Args } from '@oclif/core';

import { AgentPick } from '../../../application/agent/pick.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class AgentPickCommand extends FxCommand {
  static override description =
    'Add coding agents to the shared selection across workspaces registered in this FX_HOME';
  static override examples = ['<%= config.bin %> agent pick claude-code codex'];
  static override strict = false;
  static override args = {
    id: Args.string({
      ignoreStdin: true,
      required: true,
      description: 'agent id(s), e.g. claude-code',
    }),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AgentPickCommand);
    const result = await new AgentPick(this.container.config, this.container.agents).execute({
      ids: argv as string[],
      action: 'pick',
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    this.renderer.record(result);
  }
}
