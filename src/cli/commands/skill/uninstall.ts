import { SKILL_MUTATION_COLUMNS } from '../../../application/skill/standalone.js';
import { dryRunFlag } from '../../flags.js';
import { SkillCommand, skillTargetFlags } from '../../skill-command.js';

export default class SkillUninstallCommand extends SkillCommand {
  static override description = 'Remove identified fx companion Skill copies after confirmation';
  static override flags = { ...skillTargetFlags, 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillUninstallCommand);
    const rows = await this.skillWrite('uninstall', flags);
    this.renderer.list(rows, { columns: SKILL_MUTATION_COLUMNS });
  }
}
