import { Flags } from '@oclif/core';

import { RepoShow } from '../../../application/repo/show.js';
import { FxCommand } from '../../base.js';
import { requiredArgument } from '../../flags.js';
import { ownerLines } from '../../render/owners.js';

export default class RepoShowCommand extends FxCommand {
  static override description =
    'Show one repository: resolved entry, disk state, code-host URLs and responsibility facts';
  static override args = {
    name: requiredArgument('repository name'),
  };
  static override flags = {
    'as-of': Flags.string({
      description:
        'relationship validity date in the current members document (YYYY-MM-DD, default today in UTC); not a historical snapshot',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoShowCommand);
    const detail = await new RepoShow(await this.workspaceDeps()).execute({
      name: args.name,
      asOf: flags['as-of'],
    });
    this.renderer.record(detail, { describe: { owners: ownerLines } });
  }
}
