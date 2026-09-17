import { Args, Flags } from '@oclif/core';

import { recordProbe } from '../../../composition/probe-record.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, jobsFlag } from '../../flags.js';

export default class ManifestRecordProbe extends FxCommand {
  static override description =
    'Probe a repository coordinate and record definite evidence in the selected workspace source manifest';
  static override examples = [
    '<%= config.bin %> manifest record-probe example-api --env test --platform jenkins --dry-run',
  ];
  static override args = {
    repo: Args.string({ ignoreStdin: true, required: true, description: 'repository name' }),
  };
  static override flags = {
    env: Flags.string({ required: true, description: 'environment containing the coordinate' }),
    platform: Flags.string({ required: true, description: 'platform containing the coordinate' }),
    'dry-run': dryRunFlag,
    jobs: jobsFlag,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ManifestRecordProbe);
    if (flags['dry-run']) this.skipUpdateChecks();
    this.renderer.record(
      await recordProbe({
        container: this.container,
        workspace: await this.workspaceDeps(),
        login: this.loginDeps(),
        input: {
          repo: args.repo,
          env: flags.env,
          platform: flags.platform,
          check: true,
          probe: true,
          jobs: flags.jobs,
          dryRun: flags['dry-run'],
          posture: this.posture,
        },
      }),
    );
  }
}
