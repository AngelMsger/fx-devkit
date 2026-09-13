import { Args } from '@oclif/core';

import { ToolInstall } from '../../../application/tool/install.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class ToolUpdateCommand extends FxCommand {
  static override description = 'Update companion tools to their latest published version';
  static override examples = ['<%= config.bin %> tool update bitbucket-cli'];
  static override strict = false;
  static override args = {
    tool: Args.string({
      ignoreStdin: true,
      description: 'tool name(s); default: every enabled tool',
    }),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(ToolUpdateCommand);
    const { tools, workspace } = await this.toolchain();
    const names =
      argv.length === 0 ? tools.filter((t) => t.enabled).map((t) => t.name) : (argv as string[]);
    const results = await new ToolInstall(
      this.container.installers,
      this.container.process,
    ).execute({
      tools,
      names,
      update: true,
      dryRun: flags['dry-run'],
      posture: this.posture,
      trust:
        workspace === undefined
          ? undefined
          : { gate: this.trustGate(), workspace, yes: this.yes, posture: this.posture },
    });
    this.renderer.list(results, {
      columns: ['name', 'via', 'vector', 'ran', 'code', 'version_after', 'error'],
    });
  }
}
