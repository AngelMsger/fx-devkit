import { Args } from '@oclif/core';

import { runSourcePush } from '../../../composition/contributions.js';
import { FxCommand } from '../../base.js';
import { sourcePushFlags } from '../../source-flags.js';

export default class SourcePushCommand extends FxCommand {
  static override description =
    'Validate selected source files and contribute them through a personal-fork pull request\n\nCreates a commit, pushes the contribution branch to the personal fork, and creates or resumes a pull request. --dry-run validates and returns a plan without committing, pushing or creating a PR.';
  static override examples = [
    '<%= config.bin %> source push manifest/environments.yaml --issue TASK-123 --title "Update verified coordinates" --dry-run',
  ];
  static override args = {
    paths: Args.string({
      multiple: true,
      ignoreStdin: true,
      description: 'source-relative file or directory paths; prompted if omitted',
    }),
  };
  static override flags = sourcePushFlags;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SourcePushCommand);
    if (flags['dry-run']) this.skipUpdateChecks();
    const result = await runSourcePush({
      container: this.container,
      resolve: this.resolveInput(),
      noInput: this.noInput,
      user: this.user,
      request: {
        paths: args.paths ?? [],
        issue: flags.issue,
        title: flags.title,
        ...(flags.message === undefined ? {} : { message: flags.message }),
        ...(flags.pr === undefined ? {} : { prRef: flags.pr }),
        cliVersion: this.config.version,
        dryRun: flags['dry-run'],
        forceNew: flags.new,
        yes: this.yes,
        posture: this.posture,
      },
    });
    this.renderer.record(result);
  }
}
