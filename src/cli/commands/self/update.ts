import { isUpdated } from '../../../application/self/update.js';
import { selfUpdate } from '../../../composition/update.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, writeIntent } from '../../flags.js';

export default class SelfUpdateCommand extends FxCommand {
  static override description =
    'Update fx using npm registry configuration; FX_REGISTRY is an optional override';
  static override examples = [
    '<%= config.bin %> self update --dry-run',
    '<%= config.bin %> self update --yes',
  ];
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(SelfUpdateCommand);
    const update = await this.fxUpdateInput();
    const out = await selfUpdate(this.container, this.noInput).execute({
      current: update.current,
      packageName: update.packageName,
      registry: update.registry,
      ...writeIntent(flags, this.posture),
      yes: this.yes,
    });
    this.renderer.record(out);
    if (isUpdated(out))
      this.renderer.notice({
        code: 'SELF_UPDATED',
        message: 'fx was updated',
        nextSteps: ['fx --version'],
      });
  }
}
