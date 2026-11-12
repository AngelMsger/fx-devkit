import { Flags } from '@oclif/core';

import { RepoVersion } from '../../../application/repo/version.js';
import { FxCommand } from '../../base.js';
import { requiredArgument } from '../../flags.js';

export default class RepoVersionCommand extends FxCommand {
  static override description =
    'Read a pinned version declaration, its last field change and an optional historical baseline. Read-only';
  static override args = { name: requiredArgument('known repository name') };
  static override flags = {
    ref: Flags.string({
      description: 'branch, tag or commit; default: declared repository branch or remote default',
    }),
    path: Flags.string({
      description: 'repository-relative VERSION or package metadata path; supports nested packages',
    }),
    baseline: Flags.string({
      description: 'historical release ref to resolve and compare with the pinned head',
    }),
    'history-limit': Flags.integer({
      description: 'maximum first-parent commits examined',
      min: 1,
      max: 1000,
      default: 100,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoVersionCommand);
    this.renderer.record(
      await new RepoVersion(await this.workspaceDeps(), this.loginDeps()).execute({
        name: args.name,
        ref: flags.ref,
        path: flags.path,
        baseline: flags.baseline,
        historyLimit: flags['history-limit'],
      }),
    );
  }
}
