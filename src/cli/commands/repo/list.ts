import { Flags } from '@oclif/core';

import {
  REPO_COLUMNS,
  REPO_READABILITY_COLUMNS,
  RepoList,
} from '../../../application/repo/list.js';
import { FxCommand } from '../../base.js';

export default class RepoListCommand extends FxCommand {
  static override description = 'List the repositories of the workspace, picked or not';
  static override examples = [
    '<%= config.bin %> repo list --tag backend',
    '<%= config.bin %> repo list --unreadable',
  ];
  static override flags = {
    tag: Flags.string({ description: 'only repositories carrying this tag' }),
    project: Flags.string({ description: 'only repositories of this code-host project' }),
    picked: Flags.boolean({
      default: false,
      exclusive: ['unpicked'],
      description: 'only the repositories picked here',
    }),
    unpicked: Flags.boolean({
      default: false,
      exclusive: ['picked'],
      description: 'only repositories left unpicked',
    }),
    unreadable: Flags.boolean({ default: false, description: 'which the code host denies you' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RepoListCommand);
    const rows = await new RepoList(await this.workspaceDeps()).execute({
      tag: flags.tag,
      project: flags.project,
      picked: selection(flags.picked, flags.unpicked),
      unreadable: flags.unreadable,
    });
    this.renderer.list(rows, {
      columns: [...REPO_COLUMNS, ...(flags.unreadable ? REPO_READABILITY_COLUMNS : [])],
    });
  }
}

function selection(picked: boolean, unpicked: boolean): 'picked' | 'unpicked' | undefined {
  if (picked) return 'picked';
  return unpicked ? 'unpicked' : undefined;
}
