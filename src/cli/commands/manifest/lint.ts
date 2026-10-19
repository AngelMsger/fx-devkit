import { LintManifest } from '../../../application/manifest/lint.js';
import { FxCommand } from '../../base.js';

export default class ManifestLint extends FxCommand {
  static override description = 'Suggest improvements to a valid manifest; never fails';
  static override examples = ['<%= config.bin %> manifest lint'];
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(ManifestLint);
    const dir = await this.manifestDir();
    const findings = await new LintManifest({
      fs: this.container.fs,
      bundledTools: this.container.bundledTools,
      describeProvider: this.container.describeProvider,
    }).execute({
      dir,
      cliVersion: this.config.version,
      providers: this.container.providers,
    });
    this.renderer.list(findings, { columns: ['kind', 'code', 'path', 'message'] });
  }
}
