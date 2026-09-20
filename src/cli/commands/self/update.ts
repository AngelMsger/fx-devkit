import { SelfUpdate } from '../../../application/self/update.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag, writeIntent } from '../../flags.js';

export default class SelfUpdateCommand extends FxCommand {
  static override announcesSkill = false;
  static override description =
    'Update fx using npm registry configuration; FX_REGISTRY is an optional override';
  static override examples = [
    '<%= config.bin %> self update --dry-run',
    '<%= config.bin %> self update --yes',
  ];
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(SelfUpdateCommand);
    const pjson = this.config.pjson as { name: string };
    const update = await this.fxUpdateInput();
    const out = await new SelfUpdate(
      this.container.process,
      this.container.prompter(this.noInput),
      this.container.installers.find((installer) => installer.id === 'npm')!,
    ).execute({
      packageName: pjson.name,
      registry: update.registry,
      ...writeIntent(flags, this.posture),
      yes: this.yes,
    });
    this.renderer.record(out);
    if (!out.ran || out.code !== 0) return;
    const { latest } = await this.updateChecks().fx.execute(update);
    if (latest !== null) await this.updateChecks().fx.markCurrent(update, latest);
    this.renderer.notice({
      code: 'SELF_UPDATED',
      message: 'fx was updated',
      nextSteps: ['fx --version'],
    });
  }
}
