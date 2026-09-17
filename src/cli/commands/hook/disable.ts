import { manageHooks } from '../../../composition/hooks.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class HookDisableCommand extends FxCommand {
  static override description =
    'Disable workspace lifecycle hooks and remove only fx-managed entries';
  static override examples = ['<%= config.bin %> hook disable --format json'];
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(HookDisableCommand);
    const out = await manageHooks({
      container: this.container,
      resolve: this.resolveInput(),
      env: process.env,
      action: 'remove',
      posture: this.posture,
      dryRun: flags['dry-run'],
    });
    this.renderer.list(out.items, {
      columns: ['agent', 'action', 'activation', 'path', 'context', 'command'],
      trailer: {
        workspace: out.workspace,
        root: out.root,
        enabled: out.enabled,
        observations: out.state?.observations ?? [],
      },
    });
  }
}
