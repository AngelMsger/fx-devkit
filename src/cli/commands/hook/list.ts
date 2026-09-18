import { HookCommand } from '../../hook-command.js';

export default class HookListCommand extends HookCommand {
  static override description =
    'Show workspace lifecycle capabilities, projections and recent automatic sync evidence';
  static override examples = ['<%= config.bin %> hook list --format json'];

  async run(): Promise<void> {
    await this.parse(HookListCommand);
    await this.reconcile('inspect', true);
  }
}
