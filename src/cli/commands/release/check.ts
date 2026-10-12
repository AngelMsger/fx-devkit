import { Flags } from '@oclif/core';

import { Release } from '../../../application/release/index.js';
import { CHECKS, type Check } from '../../../domain/release/types.js';
import { FxCommand } from '../../base.js';
import { argument, jobsFlag, listFlag } from '../../flags.js';
import { RELEASE_CODES, reportNotice } from '../../notices.js';
import { releaseText } from '../../release-view.js';

export default class ReleaseCheckCommand extends FxCommand {
  static override description =
    'Show what each repository would release and check it: dependencies, branches, builds and unresolved errors. Read-only';
  static override examples = [
    '<%= config.bin %> release check',
    '<%= config.bin %> release check --format json',
    '<%= config.bin %> release check fx-example-api --only merge --format json   # the commits behind the finding',
  ];
  static override strict = false;
  static override args = {
    repo: argument('repository name(s); default: every one on the checklist'),
  };
  static override flags = {
    tag: listFlag('only repositories carrying these tags'),
    only: listFlag('only these checks', CHECKS),
    env: Flags.string({ description: 'environment whose errors count; default: release.env' }),
    since: Flags.string({ description: 'how far back a new error counts; default: release.since' }),
    jobs: jobsFlag,
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(ReleaseCheckCommand);
    const report = await new Release(await this.workspaceDeps(), this.loginDeps()).execute({
      repos: argv.length === 0 ? undefined : (argv as string[]),
      tags: flags.tag,
      only: flags.only as Check[] | undefined,
      env: flags.env,
      since: flags.since,
      jobs: flags.jobs,
    });
    // --fields selects from the report itself, in every format.
    if (this.format === 'human' && this.renderOptions.fields === undefined)
      this.renderer.text(
        releaseText(report, {
          display: this.renderer.display.out,
          details: this.renderOptions.details === true,
        }),
      );
    else this.renderer.record(report);
    this.renderer.notice(
      reportNotice(report, RELEASE_CODES, ['fx release check <repo> --format json']),
    );
  }
}
