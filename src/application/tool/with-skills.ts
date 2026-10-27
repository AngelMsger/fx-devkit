// `fx tool install` and `fx tool update`: the package operation, then the Skill of every
// tool it installed or updated, so the agents read the instructions of the version now on
// PATH. Init and sync run their own Skill stage after installing and do not come here.

import type { ResolvedShell } from '../../domain/shell.js';
import type { Process } from '../../ports/process.js';
import type { Reporter } from '../../ports/reporter.js';
import type { SkillDeps } from '../skill/targets.js';
import {
  planToolSkills,
  runTools,
  toolSkillOutcome,
  type ToolSkillOutcome,
} from '../skill/tool-skills.js';
import { recoveryCommand } from '../workspace/guidance.js';

import type { ToolInstall, ToolInstallInput, ToolInstallOutput } from './install.js';

export const TOOL_INSTALL_COLUMNS = [
  'name',
  'via',
  'vector',
  'ran',
  'code',
  'version_after',
  'skill',
  'error',
] as const;

export interface ToolInstallWithSkillsDeps {
  readonly install: ToolInstall;
  readonly process: Process;
  readonly commandShell?: ResolvedShell;
  readonly reporter: Reporter;
  readonly skills: SkillDeps;
}

export interface ToolInstallRow extends ToolInstallOutput {
  readonly skill: ToolSkillOutcome;
}

export class ToolInstallWithSkills {
  constructor(private readonly deps: ToolInstallWithSkillsDeps) {}

  async execute(input: ToolInstallInput): Promise<ToolInstallRow[]> {
    const results = await this.deps.install.execute(input);
    const changed = new Set(results.filter(changedPackage).map((row) => row.name));
    const items = await planToolSkills(this.deps, this.deps.skills, {
      tools: input.tools.filter((tool) => changed.has(tool.name)),
      dryRun: input.dryRun,
      posture: input.posture,
      trust: input.trust,
    });
    if (!input.dryRun) await runTools(this.deps, items);
    if (input.update && input.all === true) this.notInstalled(input, results);
    return results.map((row) => ({ ...row, skill: toolSkillOutcome(items, row.name) }));
  }

  // A workspace's toolchain is what it needs, so one of its tools left out of `update --all`
  // for not being installed is worth a word; the bundled catalog outside one is not.
  private notInstalled(input: ToolInstallInput, results: readonly ToolInstallOutput[]): void {
    const workspace = input.trust?.workspace;
    if (workspace === undefined) return;
    const updated = new Set(results.map((row) => row.name));
    const missing = input.tools.filter((tool) => tool.enabled && !updated.has(tool.name));
    if (missing.length === 0) return;
    this.deps.reporter.notice({
      code: 'TOOLS_NOT_INSTALLED',
      message: `not installed, so not updated: ${missing.map((tool) => tool.name).join(', ')}`,
      nextSteps: [
        recoveryCommand(
          { workspace, commandShell: this.deps.commandShell },
          'tool',
          'install',
          '--all',
        ),
      ],
    });
  }
}

// A row whose package operation ran, or would run in a preview; a manual tool has none.
function changedPackage(row: ToolInstallOutput): boolean {
  return row.vector !== null && (row.status === 'done' || row.status === 'planned');
}
