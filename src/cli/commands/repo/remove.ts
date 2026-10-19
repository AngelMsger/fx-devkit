import { RepoRemove } from '../../../application/repo/remove.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';
import type { WriteScopeDeclaration } from '../../workspace-write-policy.js';

export default class RepoRemoveCommand extends FxCommand {
  static override description = 'Unregister a machine-local repository; the directory is kept';
  static override args = {
    name: requiredArgument('repository name'),
  };
  static override flags = { 'dry-run': dryRunFlag };
  static override writeScope: WriteScopeDeclaration = 'workspace';

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoRemoveCommand);
    const result = await new RepoRemove(await this.workspaceDeps()).execute({
      name: args.name,
      ...writeIntent(flags, this.posture),
    });
    this.renderer.record(result);
  }
}
