import { Flags } from '@oclif/core';

import { Release } from '../../../application/release/index.js';
import { CHECKS, type Check } from '../../../domain/release/types.js';
import { FxCommand } from '../../base.js';
import { argument, jobsFlag, listFlag } from '../../flags.js';
import { RELEASE_CODES, reportNotice } from '../../notices.js';
import { releaseText } from '../../release-view.js';

import { repoOverrides } from './overrides.js';

export default class ReleaseCheckCommand extends FxCommand {
  static override description =
    'Show what each repository would release and check it: dependencies, branches, builds and unresolved errors. Read-only';
  static override examples = [
    '<%= config.bin %> release check',
    '<%= config.bin %> release check --format json',
    '<%= config.bin %> release check fx-example-api --only merge',
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
    from: Flags.string({
      description:
        'inclusive error-window start, ISO timestamp with timezone; requires --to and excludes --since',
    }),
    to: Flags.string({
      description: 'exclusive error-window end, ISO timestamp with timezone; requires --from',
    }),
    'version-history': Flags.boolean({
      description: 'read the last version-field change at each pinned source head',
      default: false,
    }),
    'history-limit': Flags.integer({
      description: 'maximum first-parent commits per version history',
      min: 1,
      max: 1000,
      default: 100,
    }),
    baseline: Flags.string({
      description: 'historical release baseline as repo=ref; repeat for multiple repositories',
      multiple: true,
    }),
    'version-path': Flags.string({
      description:
        'explicit version declaration as repo=path, including nested packages; repeatable',
      multiple: true,
    }),
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
      from: flags.from,
      to: flags.to,
      versionHistory: flags['version-history'],
      historyLimit: flags['history-limit'],
      baselines: repoOverrides(flags.baseline),
      versionPaths: repoOverrides(flags['version-path']),
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
