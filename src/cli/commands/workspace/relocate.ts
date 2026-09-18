import { workspaceManagement } from '../../../composition/workspace-management.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';

export default class WorkspaceRelocate extends FxCommand {
  static override description =
    'Point a workspace identity at its moved directory, preserving personal selections and checkout files; run sync afterwards to regenerate owned resources';
  static override args = {
    name: requiredArgument('registered workspace name'),
    dir: requiredArgument('existing directory after moving the workspace'),
  };
  static override flags = { 'dry-run': dryRunFlag };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkspaceRelocate);
    this.renderer.record(
      await workspaceManagement(this.harnessInput()).execute({
        name: args.name,
        action: 'relocate',
        root: args.dir,
        ...writeIntent(flags, this.posture),
      }),
    );
  }
}
