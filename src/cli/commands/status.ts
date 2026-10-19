import { Flags } from '@oclif/core';

import { WorkspaceStatus, type StatusInput } from '../../application/workspace/status.js';
import { FxCommand } from '../base.js';
import { jobsFlag, writeIntent } from '../flags.js';
import type { WriteScopeDeclaration } from '../workspace-write-policy.js';

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
  static override writeScope: WriteScopeDeclaration = (flags) =>
    flags['fetch'] ? 'workspace' : null;

  async run(): Promise<void> {
    const { flags } = await this.parse(StatusCommand);
    const input: StatusInput = flags.fetch
      ? {
          fetch: true,
          dirtyOnly: flags.dirty,
          ...writeIntent(flags, this.posture),
          jobs: flags.jobs,
        }
      : { fetch: false, dirtyOnly: flags.dirty, jobs: flags.jobs };
    const { items, ...summary } = await new WorkspaceStatus(await this.workspaceDeps(), {
      hosts: this.skillDeps().hosts,
      login: this.loginDeps(),
    }).execute(input);
    this.renderer.list(items, {
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
      trailer: summary,
    });
  }
}
