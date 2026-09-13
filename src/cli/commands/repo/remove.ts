import { Args } from '@oclif/core';

import { RepoRemove } from '../../../application/repo/remove.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class RepoRemoveCommand extends FxCommand {
  static override description = 'Unregister a machine-local repository; the directory is kept';
  static override args = {
    name: Args.string({ ignoreStdin: true, required: true, description: 'repository name' }),
  };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoRemoveCommand);
    const result = await new RepoRemove(await this.workspaceDeps()).execute({
      name: args.name,
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    this.renderer.record(result);
  }
}
