import { Flags } from '@oclif/core';

import { editSelection } from '../../../application/repo/selection.js';
import { selectOperation } from '../../../application/workspace/scope.js';
import { FxCommand } from '../../base.js';
import { argument, dryRunFlag, writeIntent } from '../../flags.js';

export default class RepoSelectCommand extends FxCommand {
  static override description =
    'Replace the shared repository selection; --all follows current and future declarations, --none selects none. Run fx sync afterward to prepare selected repositories; existing checkouts are preserved.';
  static override examples = [
    '<%= config.bin %> repo select api web',
    '<%= config.bin %> repo select --all',
  ];
  static override strict = false;
  static override args = {
    name: argument('names to select exclusively'),
  };
  static override flags = {
    all: Flags.boolean({
      exclusive: ['none'],
      description: 'follow all shared declarations, including future additions',
    }),
    none: Flags.boolean({ exclusive: ['all'], description: 'select no shared repositories' }),
    'dry-run': dryRunFlag,
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(RepoSelectCommand);
    const operation = selectOperation(flags.all, flags.none);
    const result = await editSelection(
      await this.workspaceDeps(),
      {
        names: argv as string[],
        ...writeIntent(flags, this.posture),
      },
      operation,
    );
    this.renderer.record(result);
  }
}
