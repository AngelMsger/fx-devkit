import { SKILL_LOADED_ENV } from '../../../application/skill/notice.js';
import { SkillCommand, skillTargetFlags } from '../../skill-command.js';

export default class SkillStatusCommand extends SkillCommand {
  static override description =
    'Report companion Skill installation, version alignment and loaded handshake separately';
  static override flags = skillTargetFlags;

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillStatusCommand);
    this.renderer.record(
      await this.companionSkill().status(
        {
          agents: flags.agent,
          project: flags.project,
          dir: flags.dir,
          cwd: process.cwd(),
        },
        process.env[SKILL_LOADED_ENV] === '1',
      ),
    );
  }
}
