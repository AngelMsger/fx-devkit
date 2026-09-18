import { Args, Flags } from '@oclif/core';

import { TOOL_INSTALL_COLUMNS } from '../../../application/tool/install.js';
import { assertToolSelection } from '../../../application/tool/select.js';
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
  static override args = {
    tool: Args.string({
      ignoreStdin: true,
      description: 'tool name(s); required unless --all is given',
    }),
  };
  static override flags = {
    all: Flags.boolean({ default: false, description: 'every enabled tool that is missing' }),
    'dry-run': dryRunFlag,
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(ToolInstallCommand);
    assertToolSelection(argv as string[], flags.all);
    const { tools, workspace } = await this.toolchain();
    const results = await toolInstall(this.container).execute({
      tools,
      commandShell: this.commandShell,
      names: argv.length === 0 ? undefined : (argv as string[]),
      all: flags.all,
      update: false,
      dryRun: flags['dry-run'],
      posture: this.posture,
      trust:
        workspace === undefined
          ? undefined
          : {
              gate: this.trustGate(),
              workspace,
              commandShell: this.commandShell,
              yes: this.yes,
              posture: this.posture,
            },
    });
    this.renderer.list(results, {
      columns: TOOL_INSTALL_COLUMNS,
    });
  }
}
