import { SKILL_MUTATION_COLUMNS } from '../../../application/skill/standalone.js';
import { dryRunFlag } from '../../flags.js';
import { SkillCommand, skillTargetFlags } from '../../skill-command.js';

export default class SkillInstallCommand extends SkillCommand {
  static override description =
    'Install or refresh the bundled fx companion Skill without a workspace';
  static override examples = [
    '<%= config.bin %> skill install',
    '<%= config.bin %> skill install --agent codex --project',
    '<%= config.bin %> skill install --dir ./skills --dry-run',
  ];
  static override flags = { ...skillTargetFlags, 'dry-run': dryRunFlag };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillInstallCommand);
    const rows = await this.skillWrite('install', flags);
    this.renderer.list(rows, { columns: SKILL_MUTATION_COLUMNS });
  }
}
