import { Flags } from '@oclif/core';

import { syncStageIds } from '../../application/sync/stages.js';
import { Sync } from '../../application/sync.js';
import { refreshManifestBeforeSync } from '../../composition/refresh.js';
import { selectSyncStages } from '../../domain/sync-selection.js';
import { FxCommand } from '../base.js';
import { detailsFlag, dryRunFlag, jobsFlag, listFlag } from '../flags.js';
import { syncNotices } from '../notices.js';

export default class SyncCommand extends FxCommand {
  static override description =
    "Bring the workspace up to date: clone what is missing, fast-forward what is clean, never touch work in progress\n\nExplicit sync also prepares declared public service settings. It never acquires or distributes personal credentials.\n\nThe result may be partial even with exit zero. Inspect summary.failed, summary.unreadable, stages and each failed item's structured failure before retrying.";
  static override examples = [
    '<%= config.bin %> sync',
    '<%= config.bin %> sync --dry-run --format json',
  ];
  static override flags = {
    details: detailsFlag,
    'dry-run': dryRunFlag,
    only: listFlag('run selected stages', syncStageIds()),
    jobs: jobsFlag,
    'refresh-manifest': Flags.boolean({
      default: true,
      allowNo: true,
      description: 'pull the manifest repository first; --no-refresh-manifest skips it',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SyncCommand);
    const only = selectSyncStages(flags.only?.join(','), syncStageIds());
    const run = { dryRun: flags['dry-run'], posture: this.posture };
    if (flags['refresh-manifest'])
      await refreshManifestBeforeSync(this.container, this.resolveInput(), run);
    const deps = await this.workspaceDeps();
    const out = await new Sync(deps).execute({
      ...run,
      jobs: flags.jobs,
      only,
      stages: this.stages(deps, run.dryRun),
    });
    const visible =
      this.format === 'human' && !flags.verbose
        ? out.items.filter((item) => item.action !== 'skip_unpicked')
        : out.items;
    this.renderer.list(visible, {
      columns: ['name', 'action', 'result', 'outcome', 'reason'],
      trailer: {
        operation: out.operation,
        preparation_complete: out.preparation_complete,
        summary: out.summary,
        stages: out.stages,
        ...(out.stage_details === undefined ? {} : { stage_details: out.stage_details }),
      },
    });
    for (const notice of syncNotices(out, run.dryRun)) this.renderer.notice(notice);
  }
}
