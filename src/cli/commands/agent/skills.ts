import { SKILL_COLUMNS, SkillList } from '../../../application/skill/list.js';
import { listFlag } from '../../flags.js';
import { SkillCommand } from '../../skill-command.js';

export default class AgentSkillsCommand extends SkillCommand {
  static override description =
    'List workspace team Skills and the bundled fx Skill for selected agents';
  static override flags = {
    agent: listFlag('only these agent ids'),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AgentSkillsCommand);
    const rows = await new SkillList(await this.workspaceDeps(), this.skillDeps()).execute(
      this.skillTarget(flags),
    );
    this.renderer.list(rows, { columns: SKILL_COLUMNS });
  }
}
