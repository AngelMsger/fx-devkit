import { dryRunFlag } from '../../flags.js';
import { HookProjectionCommand } from '../../hook-command.js';
import type { WriteScopeDeclaration } from '../../workspace-write-policy.js';

export default class HookDisableCommand extends HookProjectionCommand {
  static override description =
    'Disable workspace lifecycle hooks and remove only fx-managed entries';
  static override examples = ['<%= config.bin %> hook disable --format json'];
  static override flags = { 'dry-run': dryRunFlag };
  static override writeScope: WriteScopeDeclaration = 'workspace';

  protected override readonly action = 'remove';
}
