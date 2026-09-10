import { Flags } from '@oclif/core';

import { RenderRegions } from '../../../application/docs/render-regions.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class ManifestRenderCommand extends FxCommand {
  static override description =
    "Regenerate the manifest-derived regions of the manifest repository's AGENTS.md: the checkout under cwd, else the workspace's source copy";
  static override examples = [
    '<%= config.bin %> manifest render',
    '<%= config.bin %> manifest render --check   # CI: exit 11 when stale',
    '<%= config.bin %> manifest render --out /tmp/AGENTS.draft.md',
  ];
  static override flags = {
    check: Flags.boolean({
      default: false,
      description: 'write nothing; fail when the document is stale',
    }),
    out: Flags.string({
      description:
        'create or replace a fully rendered AGENTS.md at this path instead; nothing else is touched',
    }),
    'dry-run': dryRunFlag,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ManifestRenderCommand);
    const dir = await this.manifestDir();
    const out = await new RenderRegions({
      fs: this.container.fs,
      reporter: this.reporter,
      context: await this.manifestContext(dir),
      describeProvider: this.container.describeProvider,
    }).execute({
      check: flags.check,
      dryRun: flags['dry-run'],
      out: flags.out,
      posture: this.posture,
    });
    this.renderer.list(out.files, {
      columns: ['path', 'action', 'replaced', 'missing', 'unknown'],
    });
  }
}
