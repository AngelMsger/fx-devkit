import { Flags } from '@oclif/core';

import { RenderRegions } from '../../../application/docs/render-regions.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, writeIntent } from '../../flags.js';
import type { WriteScopeDeclaration } from '../../workspace-write-policy.js';

export default class ManifestRenderCommand extends FxCommand {
  static override description =
    'Regenerate manifest-derived AGENTS.md regions: explicit workspace selection wins, otherwise use the source checkout near cwd';
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
      char: 'o',
      description:
        'create or replace a fully rendered AGENTS.md at this path instead; nothing else is touched',
    }),
    'dry-run': dryRunFlag,
  };
  static override writeScope: WriteScopeDeclaration = (flags) => (flags['check'] ? null : 'source');

  async run(): Promise<void> {
    const { flags } = await this.parse(ManifestRenderCommand);
    const dir = await this.manifestDir();
    const out = await new RenderRegions({
      fs: this.container.fs,
      projections: this.container.projections,
      reporter: this.reporter,
      context: await this.manifestContext(dir),
      describeProvider: this.container.describeProvider,
    }).execute({
      check: flags.check,
      ...writeIntent(flags, this.posture),
      out: flags.out,
    });
    this.renderer.list(out.files, {
      columns: ['path', 'action', 'result', 'replaced', 'missing', 'unknown'],
    });
  }
}
