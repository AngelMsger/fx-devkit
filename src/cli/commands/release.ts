import { Args, Flags } from '@oclif/core';

import { Release } from '../../application/release/index.js';
import { CHECKS, type Check } from '../../domain/release/types.js';
import { FxCommand } from '../base.js';
import { detailsFlag, jobsFlag, listFlag } from '../flags.js';
import { RELEASE_CODES, reportNotice } from '../notices.js';

export default class ReleaseCommand extends FxCommand {
  static override description =
    'Check release readiness: dependencies, branches, builds and unresolved errors, one finding each';
  static override examples = [
    '<%= config.bin %> release --format json',
    '<%= config.bin %> release fx-example-api --only merge --format json   # the commits behind the finding',
  ];
  static override strict = false;
  static override args = {
    repo: Args.string({
      ignoreStdin: true,
      description: 'repository name(s); default: every one on the checklist',
    }),
  };
  static override flags = {
    details: detailsFlag,
    tag: listFlag('only repositories carrying these tags'),
    only: listFlag('only these checks', CHECKS),
    env: Flags.string({ description: 'environment whose errors count; default: release.env' }),
    since: Flags.string({ description: 'how far back a new error counts; default: release.since' }),
    jobs: jobsFlag,
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(ReleaseCommand);
    const report = await new Release(await this.workspaceDeps(), this.loginDeps()).execute({
      repos: argv.length === 0 ? undefined : (argv as string[]),
      tags: flags.tag,
      only: flags.only as Check[] | undefined,
      env: flags.env,
      since: flags.since,
      jobs: flags.jobs,
    });
    this.renderReport(report, ['group', 'level', 'id', 'message', 'fix']);
    this.renderer.notice(reportNotice(report, RELEASE_CODES, ['fx release <repo> --format json']));
  }
}
