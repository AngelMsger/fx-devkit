import { Flags } from '@oclif/core';

import { Sync } from '../../application/sync/index.js';
import { syncStageIds } from '../../application/sync/stages.js';
import { refreshManifestBeforeSync } from '../../composition/refresh.js';
import { selectSyncStages } from '../../domain/sync-selection.js';
import { FxCommand } from '../base.js';
import { dryRunFlag, jobsFlag, listFlag, writeIntent } from '../flags.js';
import type { WriteScopeDeclaration } from '../workspace-write-policy.js';

export default class SyncCommand extends FxCommand {
  static override description =
    "Bring the workspace up to date: clone what is missing, fast-forward what is clean, never touch work in progress\n\nExplicit sync also prepares declared public service settings. It never acquires or distributes personal credentials.\n\nThe result may be partial even with exit zero. Inspect summary.failed, summary.unreadable, stages and each failed item's structured failure before retrying.";
  static override examples = [
    '<%= config.bin %> sync',
    '<%= config.bin %> sync --dry-run --format json',
  ];
  static override flags = {
    'dry-run': dryRunFlag,
    only: listFlag('run selected stages', syncStageIds()),
    jobs: jobsFlag,
    'refresh-manifest': Flags.boolean({
      default: true,
      allowNo: true,
      description: 'pull the manifest repository first; --no-refresh-manifest skips it',
    }),
  };
  static override writeScope: WriteScopeDeclaration = 'workspace';

  async run(): Promise<void> {
    const { flags } = await this.parse(SyncCommand);
    const only = selectSyncStages(flags.only?.join(','), syncStageIds());
    const run = { ...writeIntent(flags, this.posture) };
    this.foldRestatedOutcomes();
    const manifest = flags['refresh-manifest']
      ? await refreshManifestBeforeSync(this.container, this.resolveInput(), run)
      : undefined;
    const out = await new Sync(await this.workspaceDeps(), this.stageDeps()).execute({
      ...run,
      manifest,
      jobs: flags.jobs,
      only,
    });
    await this.renderPreparation(out);
  }
}
