import { SKILL_INSTALLATION_COLUMNS } from '../../../application/skill/standalone.js';
import { SkillCommand, skillTargetFlags } from '../../skill-command.js';

export default class SkillPathCommand extends SkillCommand {
  static override description = 'Show companion Skill installation targets and their current state';
  static override flags = skillTargetFlags;

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillPathCommand);
    const rows = await this.companionSkill().paths({
      agents: flags.agent,
      project: flags.project,
      dir: flags.dir,
      cwd: process.cwd(),
    });
    this.renderer.list(rows, { columns: SKILL_INSTALLATION_COLUMNS });
  }
}
