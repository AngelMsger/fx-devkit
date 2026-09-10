import { Flags } from '@oclif/core';

import { ConfigExport } from '../../../application/config/export.js';
import { FxCommand } from '../../base.js';

export default class ConfigExportCommand extends FxCommand {
  static override description =
    "Write the personal state worth carrying to another machine: config.yaml and each workspace's local.yaml; never trust records, cache or credentials";
  static override examples = [
    '<%= config.bin %> config export -o me.yaml',
    '<%= config.bin %> config export --format json',
  ];
  static override flags = {
    'dry-run': Flags.boolean({
      dependsOn: ['out'],
      description: 'print the file plan instead of writing it',
    }),
    out: Flags.string({ char: 'o', description: 'file to write; default stdout (yaml)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigExportCommand);
    const exporter = new ConfigExport({
      config: this.container.config,
      localStore: this.container.localStore,
      clock: this.container.clock,
      fs: this.container.fs,
    });
    const result = await exporter.execute(
      flags.out === undefined
        ? {}
        : {
            out: flags.out,
            dryRun: flags['dry-run'],
            posture: this.posture,
          },
    );
    if (flags.out !== undefined) {
      this.renderer.record({
        path: result.path,
        workspaces: Object.keys(result.profile.workspaces),
        written: result.written,
      });
      return;
    }
    if (this.format === 'human') this.log(result.text.trimEnd());
    else this.renderer.record(result.profile);
  }
}
