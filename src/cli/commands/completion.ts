import { Args } from '@oclif/core';

import { FxCommand } from '../base.js';
import { completionScript, SHELLS } from '../completion.js';
import { globalFlags } from '../flags.js';

import { COMMANDS } from './index.js';

export default class CompletionCommand extends FxCommand {
  static override description = 'Print a shell completion script for bash, zsh, fish or PowerShell';
  static override examples = [
    '<%= config.bin %> completion zsh > ~/.zfunc/_fx',
    '<%= config.bin %> completion bash > /usr/local/etc/bash_completion.d/fx',
    '<%= config.bin %> completion fish > ~/.config/fish/completions/fx.fish',
    '<%= config.bin %> completion powershell | Out-File -Encoding utf8 fx-completion.ps1',
  ];
  static override args = {
    shell: Args.string({ ignoreStdin: true, required: true, description: SHELLS.join(', ') }),
  };
  static override flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(CompletionCommand);
    const commands = Object.entries(COMMANDS)
      .filter(([, command]) => !command.hidden)
      .map(([id, command]) => ({
        id: id.replaceAll(':', ' '),
        flags: Object.keys((command as { flags?: object }).flags ?? {}),
      }));
    this.log(completionScript(args.shell, commands, Object.keys(globalFlags)).trimEnd());
  }
}
