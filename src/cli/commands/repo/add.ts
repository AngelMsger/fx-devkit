import { Args, Flags } from '@oclif/core';

import { RepoAdd } from '../../../application/repo/add.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class RepoAddCommand extends FxCommand {
  static override description = 'Register a checkout that exists only on this machine';
  static override examples = [
    '<%= config.bin %> repo add ../scratch-x --upstream ssh://git@git.example.com:12345/lab/scratch-x.git',
  ];
  static override args = {
    path: Args.string({ required: true, description: 'directory of the checkout' }),
  };
  static override flags = {
    upstream: Flags.string({
      description: "upstream URL; defaults to the checkout's upstream or origin remote",
    }),
    'dry-run': dryRunFlag,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoAddCommand);
    const result = await new RepoAdd(await this.workspaceDeps()).execute({
      path: args.path,
      upstream: flags.upstream,
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    this.renderer.record(result);
  }
}
