import { BINDING_COLUMNS, ProvidersManifest } from '../../../application/manifest/providers.js';
import { FxCommand } from '../../base.js';

export default class ManifestProviders extends FxCommand {
  static override description =
    'Show which provider fulfils each capability, and where the binding comes from';
  static override examples = ['<%= config.bin %> manifest providers'];
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(ManifestProviders);
    const dir = await this.manifestDir();
    const bindings = await new ProvidersManifest(
      this.container.fs,
      this.container.bundledTools,
    ).execute({
      dir,
      cliVersion: this.config.version,
    });
    this.renderer.list(bindings, {
      columns: BINDING_COLUMNS,
    });
  }
}
