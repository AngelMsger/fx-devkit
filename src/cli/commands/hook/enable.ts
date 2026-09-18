import { HARNESS_COLUMNS } from '../../../application/harness/types.js';
import { manageHooks } from '../../../composition/hooks.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class HookEnableCommand extends FxCommand {
  static override description =
    'Enable and project lifecycle hooks for the selected agents in this workspace';
  static override examples = ['<%= config.bin %> hook enable --format json'];
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(HookEnableCommand);
    const out = await manageHooks({
      container: this.container,
      resolve: this.resolveInput(),
      env: process.env,
      action: 'inject',
      posture: this.posture,
      dryRun: flags['dry-run'],
    });
    this.renderer.list(out.items, {
      columns: HARNESS_COLUMNS,
      trailer: {
        workspace: out.workspace,
        root: out.root,
        enabled: out.enabled,
        observations: out.state?.observations ?? [],
      },
    });
  }
}
