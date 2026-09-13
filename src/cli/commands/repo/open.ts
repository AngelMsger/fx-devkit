import { Args } from '@oclif/core';

import { RepoOpen } from '../../../application/repo/open.js';
import { FxCommand } from '../../base.js';

export default class RepoOpenCommand extends FxCommand {
  static override description =
    'Print the code-host page of a repository, and open it when on a terminal';
  static override args = {
    name: Args.string({ ignoreStdin: true, required: true, description: 'repository name' }),
  };
  static override flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(RepoOpenCommand);
    const result = new RepoOpen(await this.workspaceDeps()).execute({ name: args.name });
    this.renderer.record(result);
    if (process.stdout.isTTY) {
      if (!(await this.container.openUrl(result.url)))
        this.renderer.notice({
          code: 'BROWSER_OPEN_FAILED',
          message: 'The browser could not be opened; use the URL printed above.',
        });
    }
  }
}
