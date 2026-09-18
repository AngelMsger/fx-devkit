import { RepoPick } from '../../../application/repo/pick.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';

export default class RepoPickCommand extends FxCommand {
  static override description =
    'Add shared repositories to the current selection; already-all is unchanged. Use repo select to replace it.';
  static override examples = ['<%= config.bin %> repo pick fx-example-api fx-example-auth'];
  static override strict = false;
  static override args = {
    name: requiredArgument('repository name(s)'),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(RepoPickCommand);
    const result = await new RepoPick(await this.workspaceDeps()).execute({
      names: argv as string[],
      ...writeIntent(flags, this.posture),
    });
    this.renderer.record(result);
  }
}
