import { RepoShow } from '../../../application/repo/show.js';
import { FxCommand } from '../../base.js';
import { requiredArgument } from '../../flags.js';
import { ownerLines } from '../../render/owners.js';

export default class RepoShowCommand extends FxCommand {
  static override description =
    'Show one repository: resolved entry, disk state, code-host URLs and owners';
  static override args = {
    name: requiredArgument('repository name'),
  };
  static override flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(RepoShowCommand);
    const detail = await new RepoShow(await this.workspaceDeps()).execute({ name: args.name });
    this.renderer.record(detail, { describe: { owners: ownerLines } });
  }
}
