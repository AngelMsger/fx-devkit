import { dryRunFlag } from '../../flags.js';
import { HookProjectionCommand } from '../../hook-command.js';
import type { WriteScopeDeclaration } from '../../workspace-write-policy.js';

export default class HookEnableCommand extends HookProjectionCommand {
  static override description =
    'Enable and project lifecycle hooks for the selected agents in this workspace';
  static override examples = ['<%= config.bin %> hook enable --format json'];
  static override flags = { 'dry-run': dryRunFlag };
  static override writeScope: WriteScopeDeclaration = 'workspace';

  protected override readonly action = 'inject';
}
