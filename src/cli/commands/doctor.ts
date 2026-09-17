import { Flags } from '@oclif/core';

import { Doctor } from '../../application/doctor/index.js';
import { toolInventory } from '../../composition/tool-inventory.js';
import { FxCommand } from '../base.js';
import { detailsFlag, listFlag } from '../flags.js';
import { DOCTOR_CODES, reportNotice } from '../notices.js';

export default class DoctorCommand extends FxCommand {
  static override description =
    'Check repositories, tools, login state, agent Skills, the manifest and whether fx or the manifest is behind, in one pass';
  static override examples = [
    '<%= config.bin %> doctor',
    '<%= config.bin %> doctor --env test --format json',
    '<%= config.bin %> doctor --fix   # run-type login steps and Skill links; nothing a person must do',
  ];
  static override flags = {
    details: detailsFlag,
    fix: Flags.boolean({ description: 'apply the fixes fx can make itself' }),
    env: listFlag('only these environments (provider tool and login checks)'),
    tool: listFlag('check these tools explicitly (default: declared tools and active providers)'),
    'dry-run': Flags.boolean({
      dependsOn: ['fix'],
      description: 'print the fix plan instead of applying it',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DoctorCommand);
    const deps = await this.workspaceDeps();
    const report = await new Doctor(deps, {
      extensions: this.hookDoctorChecks(),
      inventory: toolInventory(this.container, this.config.version),
      login: this.loginDeps(),
      skills: this.skillDeps(),
      bundledTools: this.container.bundledTools,
      updates: { ...this.updateChecks(), self: this.fxUpdateInput(), enabled: this.updateChecksOn },
    }).execute({
      envs: flags.env,
      tools: flags.tool,
      fix: flags.fix,
      dryRun: flags['dry-run'],
      noInput: this.noInput,
      posture: this.posture,
    });
    if (this.format === 'human') {
      this.renderer.list(report.findings, {
        fullReport: report,
        columns: ['group', 'level', 'coverage', 'id', 'message', 'fix'],
      });
    } else {
      this.renderer.record(report);
    }
    for (const repair of report.repairs) {
      if (repair.status === 'failed')
        this.renderer.notice({
          code: 'DOCTOR_REPAIR_FAILED',
          message: `${repair.group}: ${repair.failure?.message ?? 'repair failed'}`,
          nextSteps: repair.failure?.next_steps ?? ['fx doctor'],
          data: { repair },
        });
    }
    this.renderer.notice(reportNotice(report, DOCTOR_CODES));
  }
}
