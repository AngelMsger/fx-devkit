import { dryRunFlag } from '../../flags.js';
import { HookProjectionCommand } from '../../hook-command.js';

export default class HookDisableCommand extends HookProjectionCommand {
  static override description =
    'Disable workspace lifecycle hooks and remove only fx-managed entries';
  static override examples = ['<%= config.bin %> hook disable --format json'];
  static override flags = { 'dry-run': dryRunFlag };

  protected override readonly action = 'remove';
}
