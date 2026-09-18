import { Flags } from '@oclif/core';

import { Status, type StatusInput } from '../../application/status.js';
import { shellLine } from '../../domain/shell.js';
import { FxCommand } from '../base.js';
import { jobsFlag, writeIntent } from '../flags.js';

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
          ...writeIntent(flags, this.posture),
          jobs: flags.jobs,
        }
      : { fetch: false, dirtyOnly: flags.dirty, jobs: flags.jobs };
    const deps = await this.workspaceDeps();
    const rows = await new Status(deps).execute(input);
    const selected = deps.ctx.workspace.repos.length;
    const declared = deps.ctx.manifest.workspace.result.doc.repos.length;
    const emptyReason = statusEmptyReason(rows.length, selected, declared, flags.dirty);
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
      trailer: {
        workspace: deps.ctx.name,
        root: deps.ctx.root,
        selection: deps.ctx.selection,
        selected_repositories: selected,
        ...(emptyReason === null
          ? {}
          : {
              empty_reason: emptyReason,
              next_steps:
                emptyReason === 'no_repositories_selected'
                  ? [
                      shellLine(
                        ['fx', 'repo', 'list', '--workspace', deps.ctx.name],
                        this.commandShell,
                      ),
                      shellLine(
                        ['fx', 'repo', 'select', '--all', '--workspace', deps.ctx.name],
                        this.commandShell,
                      ),
                    ]
                  : [],
            }),
      },
    });
  }
}

function statusEmptyReason(
  rows: number,
  selected: number,
  declared: number,
  dirtyOnly: boolean,
): string | null {
  if (rows > 0) return null;
  if (selected === 0)
    return declared === 0 ? 'no_repositories_declared' : 'no_repositories_selected';
  return dirtyOnly ? 'no_uncommitted_changes' : 'no_repositories';
}
