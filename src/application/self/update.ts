// Update fx through its distribution registry after confirmation and the write gate.
// Capture installer output so machine-readable results remain valid on stdout. A
// completed install settles the update-check window on the version it installed, then
// has the installed fx refresh the copies of its Skill that are now older than it: only
// the new installation knows its own Skill and version.

import { DevkitError } from '../../domain/errors.js';
import { stderrReason } from '../../domain/toolchain/stderr.js';
import type { Installer } from '../../ports/installer.js';
import type { Process } from '../../ports/process.js';
import type { Prompter } from '../../ports/prompter.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import type { FxUpdateCheck, FxUpdateInput } from '../update/fx.js';

import { REGISTRY_HANDOFF } from './registry.js';

export interface SelfUpdateInput extends Pick<
  FxUpdateInput,
  'current' | 'packageName' | 'registry'
> {
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly posture: WritePosture;
}

export interface SelfUpdateOutput {
  readonly vector: readonly string[];
  readonly ran: boolean;
  readonly code: number | null;
  readonly reason: string | null;
  readonly skill_refresh: SkillRefresh;
}

export interface SkillRefresh {
  readonly vector: readonly string[];
  readonly ran: boolean;
  readonly code: number | null;
  // Copies brought to the installed version; null when the refresh did not report.
  readonly refreshed: number | null;
  readonly reason: string | null;
}

export function isUpdated(output: SelfUpdateOutput): boolean {
  return output.ran && output.code === 0;
}

export interface SelfUpdateDeps {
  readonly process: Pick<Process, 'run'>;
  readonly prompter: Prompter;
  readonly installer: Installer;
  readonly check: Pick<FxUpdateCheck, 'execute' | 'markCurrent'>;
  // The installed fx's own `skill update`, run after the package changed under it.
  readonly skillRefresh: readonly string[];
}

export class SelfUpdate {
  constructor(private readonly deps: SelfUpdateDeps) {}

  async execute(input: SelfUpdateInput): Promise<SelfUpdateOutput> {
    const vector = this.plan(input);
    const unrun = (reason: string): SelfUpdateOutput => ({
      vector,
      ran: false,
      code: null,
      reason,
      skill_refresh: this.unrefreshed(reason),
    });
    if (input.dryRun) return unrun('dry run');
    assertWritable(input.posture, 'self update');
    await this.assertInstaller();
    if (!input.yes) {
      const go = await this.deps.prompter.confirm(`Run \`${vector.join(' ')}\`?`, {
        defaultYes: true,
      });
      if (!go) return unrun('declined');
    }
    const result = await this.deps.process.run(vector, { interactive: false });
    if (result.code !== 0)
      return {
        vector,
        ran: true,
        code: result.code,
        reason: stderrReason(result.stderr, result.code),
        skill_refresh: this.unrefreshed('fx was not updated'),
      };
    await this.settleCheck(input);
    return { vector, ran: true, code: 0, reason: null, skill_refresh: await this.refreshSkill() };
  }

  private plan(input: SelfUpdateInput): readonly string[] {
    if (input.registry === null) {
      throw new DevkitError(
        'config',
        'REGISTRY_UNKNOWN',
        'No valid update registry is configured',
        {
          hint: 'Check npm registry configuration and any FX_REGISTRY override; follow the registry setup handoff.',
          nextSteps: ['fx self info'],
          handoff: REGISTRY_HANDOFF,
        },
      );
    }
    const vector = this.deps.installer.vector(input.packageName, {
      registry: input.registry,
      update: true,
      registryScope: 'package',
    });
    if (!vector)
      throw new DevkitError('config', 'REGISTRY_UNKNOWN', 'The installer cannot plan this update', {
        nextSteps: ['fx self info', `Update ${input.packageName} with your package manager.`],
      });
    return vector;
  }

  private async assertInstaller(): Promise<void> {
    if (await this.deps.installer.available()) return;
    throw new DevkitError('config', 'TOOL_MISSING', 'The self-update installer is unavailable', {
      nextSteps: ['Install npm or add it to PATH, then retry.'],
      handoff: {
        summary: 'The package installer is missing.',
        command: 'fx self info --format json',
        userSteps: [
          { id: 'self-installer', kind: 'manual', title: 'Install npm or add it to PATH.' },
        ],
      },
    });
  }

  private unrefreshed(reason: string): SkillRefresh {
    return { vector: this.deps.skillRefresh, ran: false, code: null, refreshed: null, reason };
  }

  private async refreshSkill(): Promise<SkillRefresh> {
    const vector = this.deps.skillRefresh;
    const result = await this.deps.process.run(vector, {
      diagnostic: { phase: 'fx skill update' },
    });
    return {
      vector,
      ran: true,
      code: result.code,
      refreshed: result.code === 0 ? refreshedCopies(result.stdout) : null,
      reason: result.code === 0 ? null : stderrReason(result.stderr, result.code),
    };
  }

  private async settleCheck(input: SelfUpdateInput): Promise<void> {
    const { latest } = await this.deps.check.execute(input);
    if (latest !== null) await this.deps.check.markCurrent(input, latest);
  }
}

// `skill update --format json` lists each copy it considered; a refreshed one now says installed.
function refreshedCopies(stdout: string): number | null {
  try {
    const { items } = JSON.parse(stdout) as { items?: readonly { status?: string }[] };
    return Array.isArray(items) ? items.filter((item) => item.status === 'installed').length : null;
  } catch {
    return null;
  }
}
