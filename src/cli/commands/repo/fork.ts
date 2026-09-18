import { RepoFork } from '../../../application/repo/fork.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';

export default class RepoForkCommand extends FxCommand {
  static override description = 'Create your personal fork on the code host and point origin at it';
  static override args = {
    name: requiredArgument('repository name'),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoForkCommand);
    const result = await new RepoFork(await this.workspaceDeps()).execute({
      name: args.name,
      ...writeIntent(flags, this.posture),
    });
    this.renderer.record(result);
  }
}
