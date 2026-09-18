import { workspaceManagement } from '../../../composition/workspace-management.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';

export default class WorkspaceUnregister extends FxCommand {
  static override description =
    'Stop managing one workspace: retire owned project resources, archive personal metadata and preserve business checkouts and global tools';
  static override args = {
    name: requiredArgument('registered workspace name'),
  };
  static override flags = { 'dry-run': dryRunFlag };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkspaceUnregister);
    this.renderer.record(
      await workspaceManagement(this.harnessInput()).execute({
        name: args.name,
        action: 'unregister',
        ...writeIntent(flags, this.posture),
      }),
    );
  }
}
