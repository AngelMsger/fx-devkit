import { Args } from '@oclif/core';

import { ConfigImport } from '../../../application/config/import.js';
import { DevkitError } from '../../../domain/errors.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class ConfigImportCommand extends FxCommand {
  static override description =
    "Apply a profile written by `config export`: config keys it names win, each workspace's local.yaml is replaced";
  static override examples = [
    '<%= config.bin %> config import me.yaml --dry-run',
    '<%= config.bin %> config import me.yaml',
  ];
  static override args = { file: Args.string({ required: true, description: 'the profile file' }) };
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigImportCommand);
    const text = await this.container.fs.readText(args.file);
    if (text === undefined) {
      throw new DevkitError('not_found', 'CONFIG_IMPORT_NOT_FOUND', `${args.file} does not exist`, {
        nextSteps: ['fx config export -o profile.yaml'],
      });
    }
    const out = await new ConfigImport({
      config: this.container.config,
      localStore: this.container.localStore,
    }).execute({
      text,
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    this.renderer.record(out);
    if (out.next_steps.length > 0)
      this.renderer.notice({
        code: 'CONFIG_IMPORTED',
        message: 'workspaces registered; init each one, then sync',
        nextSteps: [...out.next_steps, 'fx sync'],
      });
  }
}
