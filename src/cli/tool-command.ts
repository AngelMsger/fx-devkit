// Installation and update are one operation over the toolchain, followed by the Skills
// of the tools it installed or updated; a command only chooses the direction and the
// words it offers for it. Its strict, args and
// flags stay on each command: the parser copies a command's own static members
// and drops inherited ones.

import { assertToolSelection } from '../application/tool/select.js';
import { TOOL_INSTALL_COLUMNS } from '../application/tool/with-skills.js';
import { toolInstallWithSkills } from '../composition/tool-install.js';

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
    const results = await toolInstallWithSkills(this.container, {
      commandShell: this.commandShell,
      reporter: this.reporter,
      skills: this.skillDeps(),
    }).execute({
      tools,
      commandShell: this.commandShell,
      names: names.length === 0 ? undefined : names,
      all: flags.all,
      update: this.update,
      ...writeIntent(flags, this.posture),
      trust: workspace === undefined ? undefined : this.trustFor(workspace),
    });
    this.renderer.list(results, { columns: TOOL_INSTALL_COLUMNS });
  }
}
