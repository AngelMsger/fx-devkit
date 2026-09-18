import { Flags } from '@oclif/core';

import { dryRunFlag } from '../../flags.js';
import { ToolCommand, toolNameArgs } from '../../tool-command.js';

export default class ToolInstallCommand extends ToolCommand {
  static override description =
    'Install companion tools with the package manager the manifest names';
  static override examples = [
    '<%= config.bin %> tool install openobserve-cli',
    '<%= config.bin %> tool install --all --dry-run',
  ];
  static override strict = false;
  static override args = toolNameArgs;
  static override flags = {
    all: Flags.boolean({ default: false, description: 'every enabled tool that is missing' }),
    'dry-run': dryRunFlag,
  };

  protected override readonly update = false;
}
