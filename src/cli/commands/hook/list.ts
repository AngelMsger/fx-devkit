import { HARNESS_COLUMNS } from '../../../application/harness/types.js';
import { manageHooks } from '../../../composition/hooks.js';
import { FxCommand } from '../../base.js';

export default class HookListCommand extends FxCommand {
  static override description =
    'Show workspace lifecycle capabilities, projections and recent automatic sync evidence';
  static override examples = ['<%= config.bin %> hook list --format json'];

  async run(): Promise<void> {
    await this.parse(HookListCommand);
    const out = await manageHooks({
      container: this.container,
      resolve: this.resolveInput(),
      env: process.env,
      action: 'inspect',
      posture: this.posture,
      dryRun: true,
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
