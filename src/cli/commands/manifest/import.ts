import { Args, Flags } from '@oclif/core';

import { Import } from '../../../application/import.js';
import { importDeps } from '../../../composition/import.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class ManifestImportCommand extends FxCommand {
  static override description =
    'Describe an existing directory of repositories as a manifest, printed or written with -o; the checkouts are never touched';
  static override examples = [
    '<%= config.bin %> manifest import ~/Workspaces/fx',
    '<%= config.bin %> manifest import ~/Workspaces/fx --format json',
    '<%= config.bin %> manifest import ~/Workspaces/fx -o fx-workspace/manifest/workspace.yaml',
  ];
  static override args = {
    dir: Args.string({
      ignoreStdin: true,
      required: true,
      description: 'the directory to describe',
    }),
  };
  static override flags = {
    out: Flags.string({
      char: 'o',
      description: 'write the manifest to this file instead of printing it',
    }),
    'dry-run': dryRunFlag,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ManifestImportCommand);
    const out = await new Import(importDeps(this.container, this.reporter)).execute({
      dir: args.dir,
      out: flags.out,
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    for (const s of out.report.skipped)
      this.renderer.notice({ code: 'IMPORT_SKIPPED', message: `${s.path}: ${s.reason}` });
    for (const r of out.report.review)
      this.renderer.notice({ code: 'IMPORT_REVIEW', message: `${r.name}: ${r.note}` });
    if (this.format === 'human' && !out.written) {
      this.log(out.manifest);
      return;
    }
    this.renderer.record(out);
  }
}
