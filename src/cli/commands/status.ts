import { Flags } from '@oclif/core';

import { Status, type StatusInput } from '../../application/status.js';
import { FxCommand } from '../base.js';
import { jobsFlag } from '../flags.js';

export default class StatusCommand extends FxCommand {
  static override description =
    'Show every tracked repository: branch, cleanliness, position against upstream';
  static override examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status --fetch --dirty',
  ];
  static override flags = {
    'dry-run': Flags.boolean({
      dependsOn: ['fetch'],
      description: 'print the fetch plan instead of applying it',
    }),
    fetch: Flags.boolean({
      description: 'fetch upstream first (default: report local state only)',
    }),
    dirty: Flags.boolean({
      default: false,
      description:
        'list repositories with tracked changes or untracked files (ignored files excluded)',
    }),
    jobs: jobsFlag,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(StatusCommand);
    const input: StatusInput = flags.fetch
      ? {
          fetch: true,
          dirtyOnly: flags.dirty,
          dryRun: flags['dry-run'],
          posture: this.posture,
          jobs: flags.jobs,
        }
      : { fetch: false, dirtyOnly: flags.dirty, jobs: flags.jobs };
    const rows = await new Status(await this.workspaceDeps()).execute(input);
    this.renderer.list(rows, {
      columns: [
        'name',
        'branch',
        'uncommitted',
        'dirty',
        'untracked',
        'ahead',
        'behind',
        ...(flags.fetch ? ['fetch'] : []),
        'note',
      ],
    });
  }
}
