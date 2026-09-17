import { Args, Flags } from '@oclif/core';

import { editEnvScope } from '../../../application/env/scope.js';
import { selectOperation } from '../../../application/workspace/scope.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class EnvSelectCommand extends FxCommand {
  static override description =
    'Replace the shared environment selection; --all follows current and future declarations, --none selects none. This changes selection only; it does not perform login or setup.';
  static override examples = [
    '<%= config.bin %> env select dev',
    '<%= config.bin %> env select --all',
  ];
  static override strict = false;
  static override args = {
    name: Args.string({ ignoreStdin: true, description: 'names to select exclusively' }),
  };
  static override flags = {
    all: Flags.boolean({
      exclusive: ['none'],
      description: 'follow all shared declarations, including future additions',
    }),
    none: Flags.boolean({ exclusive: ['all'], description: 'select no shared environments' }),
    'dry-run': dryRunFlag,
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(EnvSelectCommand);
    const operation = selectOperation(flags.all, flags.none);
    const result = await editEnvScope(
      await this.workspaceDeps(),
      {
        names: argv as string[],
        dryRun: flags['dry-run'],
        posture: this.posture,
      },
      operation,
    );
    this.renderer.record(result);
  }
}
