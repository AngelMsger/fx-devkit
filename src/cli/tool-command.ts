// Installation and update are one operation over the toolchain; a command only
// chooses the direction and the words it offers for it. Its parser metadata
// stays on each command: see the command contracts in AGENTS.md.

import { TOOL_INSTALL_COLUMNS } from '../application/tool/install.js';
import { assertToolSelection } from '../application/tool/select.js';
import { toolInstall } from '../composition/tool-install.js';

import { FxCommand } from './base.js';
import { argument, writeIntent } from './flags.js';

export const toolNameArgs = {
  tool: argument('tool name(s); required unless --all is given'),
};

interface ToolSelectionFlags {
  readonly all: boolean;
  readonly 'dry-run': boolean;
}

export abstract class ToolCommand extends FxCommand {
  protected abstract readonly update: boolean;

  async run(): Promise<void> {
    const { argv, flags } = await this.parse<ToolSelectionFlags, ToolSelectionFlags, object>();
    const names = argv as string[];
    assertToolSelection(names, flags.all);
    const { tools, workspace } = await this.toolchain();
    const results = await toolInstall(this.container).execute({
      tools,
      commandShell: this.commandShell,
      names: names.length === 0 ? undefined : names,
      all: flags.all,
      update: this.update,
      ...writeIntent(flags, this.posture),
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
    this.renderer.list(results, { columns: TOOL_INSTALL_COLUMNS });
  }
}
