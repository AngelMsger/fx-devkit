import { dryRunFlag } from '../../flags.js';
import { SkillCommand, skillTargetFlags } from '../../skill-command.js';

export default class SkillUninstallCommand extends SkillCommand {
  static override description = 'Remove identified fx companion Skill copies after confirmation';
  static override flags = { ...skillTargetFlags, 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillUninstallCommand);
    const rows = await this.companionSkill().write('uninstall', {
      agents: flags.agent,
      project: flags.project,
      dir: flags.dir,
      cwd: process.cwd(),
      dryRun: flags['dry-run'],
      posture: this.posture,
      yes: this.yes,
    });
    this.renderer.list(rows, { columns: ['agent', 'path', 'action', 'status', 'version'] });
  }
}
