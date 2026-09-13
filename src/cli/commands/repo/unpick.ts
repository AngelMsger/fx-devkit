import { Args } from '@oclif/core';

import { RepoUnpick } from '../../../application/repo/unpick.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class RepoUnpickCommand extends FxCommand {
  static override description =
    'Stop tracking shared repositories on this machine; nothing on disk changes';
  static override examples = ['<%= config.bin %> repo unpick fx-example-docs'];
  static override strict = false;
  static override args = {
    name: Args.string({ ignoreStdin: true, required: true, description: 'repository name(s)' }),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(RepoUnpickCommand);
    const result = await new RepoUnpick(await this.workspaceDeps()).execute({
      names: argv as string[],
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    this.renderer.record(result);
  }
}
