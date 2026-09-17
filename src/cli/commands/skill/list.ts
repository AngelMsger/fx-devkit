import { SkillList } from '../../../application/skill/list.js';
import { FxCommand } from '../../base.js';
import { listFlag } from '../../flags.js';

export default class SkillListCommand extends FxCommand {
  static override description =
    'List workspace team Skills and the bundled fx Skill for selected agents';
  static override flags = {
    agent: listFlag('only these agent ids'),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillListCommand);
    const rows = await new SkillList(await this.workspaceDeps(), this.skillDeps()).execute({
      agents: flags.agent,
    });
    this.renderer.list(rows, { columns: ['name', 'kind', 'states', 'source'] });
  }
}
