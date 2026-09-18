import type { Command } from '@oclif/core';

import { FxCommand } from '../base.js';
import { completionFlags, completionScript, SHELLS } from '../completion.js';
import { globalFlags, requiredArgument } from '../flags.js';

import { compatibilityTarget } from './aliases.js';

export default class CompletionCommand extends FxCommand {
  static override announcesSkill = false;
  static override description = 'Print a shell completion script for bash, zsh, fish or PowerShell';
  static override examples = [
    '<%= config.bin %> completion zsh > ~/.zfunc/_fx',
    '<%= config.bin %> completion bash > /usr/local/etc/bash_completion.d/fx',
    '<%= config.bin %> completion fish > ~/.config/fish/completions/fx.fish',
    '<%= config.bin %> completion powershell | Out-File -Encoding utf8 fx-completion.ps1',
  ];
  static override args = {
    shell: requiredArgument(SHELLS.join(', ')),
  };
  static override flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(CompletionCommand);
    // The loaded command tree, so completion describes what oclif will route.
    const commands = this.config.commands
      .filter((command) => !command.hidden)
      .map((command) => ({
        id: command.id.replaceAll(':', ' '),
        aliasOf: compatibilityTarget(command.id)?.replaceAll(':', ' '),
        flags: completionFlags(ownFlags(command.flags)),
      }));
    this.renderer.text(
      `${completionScript(args.shell, commands, completionFlags(globalFlags)).trimEnd()}\n`,
    );
  }
}

// oclif caches the base flags onto every command; the script offers the global
// flags once, at every level.
function ownFlags(flags: Command.Loadable['flags']): Readonly<Record<string, Command.Flag.Cached>> {
  return Object.fromEntries(Object.entries(flags).filter(([name]) => !(name in globalFlags)));
}
