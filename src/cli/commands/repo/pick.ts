import { Args } from '@oclif/core';

import { RepoPick } from '../../../application/repo/pick.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class RepoPickCommand extends FxCommand {
  static override description = 'Select shared repositories to track on this machine';
  static override examples = ['<%= config.bin %> repo pick fx-example-api fx-example-auth'];
  static override strict = false;
  static override args = {
    name: Args.string({ ignoreStdin: true, required: true, description: 'repository name(s)' }),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(RepoPickCommand);
    const result = await new RepoPick(await this.workspaceDeps()).execute({
      names: argv as string[],
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    this.renderer.record(result);
  }
}
