// Update fx through its distribution registry after confirmation and the write gate.
// Capture installer output so machine-readable results remain valid on stdout.

import { DevkitError } from '../../domain/errors.js';
import { stderrReason } from '../../domain/toolchain/stderr.js';
import type { Installer } from '../../ports/installer.js';
import type { Process } from '../../ports/process.js';
import type { Prompter } from '../../ports/prompter.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import { REGISTRY_HANDOFF } from './registry.js';

export interface SelfUpdateInput {
  readonly packageName: string;
  readonly registry: string | null;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly posture: WritePosture;
}

export interface SelfUpdateOutput {
  readonly vector: readonly string[];
  readonly ran: boolean;
  readonly code: number | null;
  readonly reason: string | null;
}

export class SelfUpdate {
  constructor(
    private readonly process: Pick<Process, 'run'>,
    private readonly prompter: Prompter,
    private readonly installer: Installer,
  ) {}

  async execute(input: SelfUpdateInput): Promise<SelfUpdateOutput> {
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
    const vector = this.installer.vector(input.packageName, {
      registry: input.registry,
      update: true,
      registryScope: 'package',
    });
    if (!vector)
      throw new DevkitError('config', 'REGISTRY_UNKNOWN', 'The installer cannot plan this update', {
        nextSteps: ['fx self info', `Update ${input.packageName} with your package manager.`],
      });
    if (input.dryRun) return { vector, ran: false, code: null, reason: 'dry run' };
    assertWritable(input.posture, 'self update');
    if (!(await this.installer.available()))
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
    if (!input.yes) {
      const go = await this.prompter.confirm(`Run \`${vector.join(' ')}\`?`, { defaultYes: true });
      if (!go) return { vector, ran: false, code: null, reason: 'declined' };
    }
    const result = await this.process.run(vector, { interactive: false });
    return {
      vector,
      ran: true,
      code: result.code,
      reason: result.code === 0 ? null : stderrReason(result.stderr, result.code),
    };
  }
}
