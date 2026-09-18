import { Args } from '@oclif/core';

import { ConfigImport } from '../../../application/config/import.js';
import { DevkitError } from '../../../domain/errors.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class ConfigImportCommand extends FxCommand {
  static override description =
    'Apply a profile: named settings and personal layers win; workspace registrations merge by name, without relocating, rebinding or removing existing workspaces';
  static override examples = [
    '<%= config.bin %> config import me.yaml --dry-run',
    '<%= config.bin %> config import me.yaml',
  ];
  static override args = {
    file: Args.string({ ignoreStdin: true, required: true, description: 'the profile file' }),
  };
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
      fs: this.container.fs,
      manifestDirFor: this.container.manifestDirFor,
      commandShell: this.commandShell,
      lock: this.container.lock,
      cliVersion: this.config.version,
    }).execute({
      text,
      dryRun: flags['dry-run'],
      posture: this.posture,
    });
    this.renderer.record(out);
    if (out.next_steps.length > 0)
      this.renderer.notice({
        code: flags['dry-run'] ? 'CONFIG_IMPORT_PLANNED' : 'CONFIG_IMPORTED',
        message: flags['dry-run']
          ? 'profile import planned; after applying, complete the listed preparation steps'
          : 'profile applied; complete the listed preparation steps',
        nextSteps: out.next_steps,
      });
  }
}
