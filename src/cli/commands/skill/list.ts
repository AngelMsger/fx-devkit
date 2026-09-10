import { Flags } from '@oclif/core';

import { SkillList } from '../../../application/skill/list.js';
import { FxCommand } from '../../base.js';

export default class SkillListCommand extends FxCommand {
  static override description =
    'List team Skills and the fx Skill, with their state in each enabled agent';
  static override flags = {
    agent: Flags.string({ multiple: true, description: 'only these agent ids' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillListCommand);
    const rows = await new SkillList(await this.workspaceDeps(), this.skillDeps()).execute({
      agents: flags.agent,
    });
    this.renderer.list(rows, { columns: ['name', 'kind', 'states', 'source'] });
  }
}
