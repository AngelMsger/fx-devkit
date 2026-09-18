import { dryRunFlag } from '../../flags.js';
import { HookProjectionCommand } from '../../hook-command.js';

export default class HookEnableCommand extends HookProjectionCommand {
  static override description =
    'Enable and project lifecycle hooks for the selected agents in this workspace';
  static override examples = ['<%= config.bin %> hook enable --format json'];
  static override flags = { 'dry-run': dryRunFlag };

  protected override readonly action = 'inject';
}
