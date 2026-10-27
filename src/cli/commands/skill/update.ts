import { SKILL_MUTATION_COLUMNS } from '../../../application/skill/standalone.js';
import { dryRunFlag } from '../../flags.js';
import { SkillCommand, skillTargetFlags } from '../../skill-command.js';

export default class SkillUpdateCommand extends SkillCommand {
  static override description =
    'Refresh installed copies of the bundled fx companion Skill that are older than this fx';
  static override examples = [
    '<%= config.bin %> skill update',
    '<%= config.bin %> skill update --project --dry-run',
  ];
  static override flags = { ...skillTargetFlags, 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillUpdateCommand);
    const rows = await this.skillWrite('update', flags);
    this.renderer.list(rows, { columns: SKILL_MUTATION_COLUMNS });
  }
}
