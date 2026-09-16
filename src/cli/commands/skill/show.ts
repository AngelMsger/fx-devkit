import { SkillCommand } from '../../skill-command.js';

export default class SkillShowCommand extends SkillCommand {
  static override description =
    'Print the bundled SKILL.md verbatim (raw text in every output format)';
  static override flags = {};

  async run(): Promise<void> {
    await this.parse(SkillShowCommand);
    process.stdout.write(await this.companionSkill().show());
  }
}
