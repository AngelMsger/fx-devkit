import { SkillCommand, skillTargetFlags } from '../../skill-command.js';

export default class SkillStatusCommand extends SkillCommand {
  static override description =
    'Report companion Skill installations and versions; host activation is unverified';
  static override flags = skillTargetFlags;

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillStatusCommand);
    this.renderer.record(await this.companionSkill().status(this.skillTarget(flags)));
  }
}
