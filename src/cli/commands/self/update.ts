import { SelfUpdate } from '../../../application/self/update.js';
import { FxCommand } from '../../base.js';
import { dryRunFlag } from '../../flags.js';

export default class SelfUpdateCommand extends FxCommand {
  static override description =
    'Update fx from its distribution registry (override with FX_REGISTRY)';
  static override examples = [
    '<%= config.bin %> self update --dry-run',
    '<%= config.bin %> self update --yes',
  ];
  static override flags = { 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(SelfUpdateCommand);
    const pjson = this.config.pjson as { name: string };
    const out = await new SelfUpdate(
      this.container.process,
      this.container.prompter(this.noInput),
      this.container.installers.find((installer) => installer.id === 'npm')!,
    ).execute({
      packageName: pjson.name,
      registry: this.fxUpdateInput().registry,
      dryRun: flags['dry-run'],
      yes: this.yes,
      posture: this.posture,
    });
    this.renderer.record(out);
    if (!out.ran || out.code !== 0) return;
    const { latest } = await this.updateChecks().fx.execute(this.fxUpdateInput());
    if (latest !== null) await this.updateChecks().fx.markCurrent(this.fxUpdateInput(), latest);
    this.renderer.notice({
      code: 'SELF_UPDATED',
      message: 'fx was updated',
      nextSteps: ['fx --version'],
    });
  }
}
