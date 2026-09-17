import { Args, Flags } from '@oclif/core';

import { toolInstall } from '../../../composition/tool-install.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class ToolInstallCommand extends FxCommand {
  static override description =
    'Install companion tools with the package manager the manifest names';
  static override examples = [
    '<%= config.bin %> tool install openobserve-cli',
    '<%= config.bin %> tool install --all --dry-run',
  ];
  static override strict = false;
  static override args = { tool: Args.string({ ignoreStdin: true, description: 'tool name(s)' }) };
  static override flags = {
    all: Flags.boolean({ default: false, description: 'every enabled tool that is missing' }),
    'dry-run': dryRunFlag,
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(ToolInstallCommand);
    const { tools, workspace } = await this.toolchain();
    const results = await toolInstall(this.container).execute({
      tools,
      names: argv.length === 0 ? undefined : (argv as string[]),
      all: flags.all,
      update: false,
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
