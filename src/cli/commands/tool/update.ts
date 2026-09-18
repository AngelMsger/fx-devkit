import { Flags } from '@oclif/core';

import { dryRunFlag } from '../../flags.js';
import { ToolCommand, toolNameArgs } from '../../tool-command.js';

export default class ToolUpdateCommand extends ToolCommand {
  static override description = 'Update companion tools to their latest published version';
  static override examples = ['<%= config.bin %> tool update bitbucket-cli'];
  static override strict = false;
  static override args = toolNameArgs;
  static override flags = {
    all: Flags.boolean({
      default: false,
      description: 'every enabled tool in the selected toolchain',
    }),
    'dry-run': dryRunFlag,
  };

  protected override readonly update = true;
}
