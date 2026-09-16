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
    const rows = await this.companionSkill().write('install', {
      agents: flags.agent,
      project: flags.project,
      dir: flags.dir,
      cwd: process.cwd(),
      dryRun: flags['dry-run'],
      posture: this.posture,
      yes: this.yes,
    });
    this.renderer.list(rows, { columns: ['agent', 'path', 'action', 'status', 'version'] });
  }
}
