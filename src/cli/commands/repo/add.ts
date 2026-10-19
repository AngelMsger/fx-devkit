import { Flags } from '@oclif/core';

import { RepoAdd } from '../../../application/repo/add.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, requiredArgument, writeIntent } from '../../flags.js';
import type { WriteScopeDeclaration } from '../../workspace-write-policy.js';

export default class RepoAddCommand extends FxCommand {
  static override description = 'Register a checkout that exists only on this machine';
  static override examples = [
    '<%= config.bin %> repo add ../scratch-x --upstream ssh://git@git.example.com/lab/scratch-x.git',
  ];
  static override args = {
    path: requiredArgument('directory of the checkout'),
  };
  static override flags = {
    upstream: Flags.string({
      description: "upstream URL; defaults to the checkout's upstream or origin remote",
    }),
    'dry-run': dryRunFlag,
  };
  static override writeScope: WriteScopeDeclaration = 'workspace';

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoAddCommand);
    const result = await new RepoAdd(await this.workspaceDeps()).execute({
      path: args.path,
      upstream: flags.upstream,
      ...writeIntent(flags, this.posture),
    });
    this.renderer.record(result);
  }
}
