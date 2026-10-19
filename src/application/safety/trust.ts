// The gate every manifest-supplied command vector passes before it runs.
// Bundled defaults are trusted by construction; a team patch is trusted
// once a person has seen the exact vector and said yes (or passed --yes),
// and the fingerprint is remembered for that workspace. A run that will
// execute several vectors asks about them together, because installing the
// workspace's tools is one decision rather than one decision per package.

import { DevkitError, handoffEnvelope, type HandoffEnvelope } from '../../domain/errors.js';
import type { Origin } from '../../domain/manifest/overlay.js';
import type { ResolvedShell } from '../../domain/shell.js';
import {
  trustFingerprint,
  renderTrustContext,
  renderVector,
  type TrustExecution,
} from '../../domain/toolchain/trust.js';
import type { Clock } from '../../ports/clock.js';
import type { Prompter } from '../../ports/prompter.js';
import type { TrustStore } from '../../ports/stores.js';
import { recoveryCommand } from '../workspace/guidance.js';

import { assertWritable, type WritePosture } from './posture.js';

export interface TrustInput {
  readonly tool?: string;
  readonly commandShell?: ResolvedShell | undefined;
  readonly workspace: string;
  readonly vector: readonly string[];
  readonly label: string;
  readonly execution?: TrustExecution | undefined;
  readonly origin: Origin;
  readonly yes: boolean;
  readonly posture: WritePosture;
}

// What a use case carries when patch-supplied vectors may run on its path.
// Under a dry run nothing is recorded: an untrusted vector is reported, not
// asked about.
export interface TrustBatch extends Omit<TrustInput, 'vector'> {
  readonly vectors: readonly (readonly string[])[];
}

export interface TrustContext {
  readonly commandShell?: ResolvedShell | undefined;
  readonly gate: TrustGate;
  readonly workspace: string;
  readonly yes: boolean;
  readonly dryRun?: boolean;
  readonly posture: WritePosture;
}

export class TrustGate {
  constructor(
    private readonly store: TrustStore,
    private readonly prompter: Prompter,
    private readonly _clock: Clock,
  ) {}

  async ensure(input: TrustInput): Promise<void> {
    await this.decide(input, renderVector(input.vector));
  }

  // The set is what the answer is remembered for, so adding a tool asks again.
  async ensureAll(input: TrustBatch): Promise<void> {
    if (input.vectors.length === 0) return;
    await this.decide(
      { ...input, vector: input.vectors.map((vector) => JSON.stringify(vector)) },
      input.vectors.map((vector) => renderVector(vector)).join('\n  '),
    );
  }

  private async decide(input: TrustInput, shown: string): Promise<void> {
    if (await this.isTrusted(input)) return;
    assertWritable(input.posture, `trust ${input.label}`);
    if (!input.yes) await this.confirm(input, shown);
    await this.store.trust(input.workspace, trustFingerprint(input), input.label);
  }

  async isTrusted(
    input: Pick<TrustInput, 'workspace' | 'vector' | 'origin' | 'execution'>,
  ): Promise<boolean> {
    if (input.origin === 'base') return true;
    return this.store.isTrusted(input.workspace, trustFingerprint(input));
  }

  private async confirm(input: TrustInput, vectors: string): Promise<void> {
    const shown = vectors + renderTrustContext(input.execution);
    let ok: boolean;
    try {
      ok = await this.prompter.confirm(
        `The workspace manifest requests, for ${input.label}:\n  ${shown}\nTrust this command (it will be remembered for this workspace)?`,
        { commands: ['Re-run this command in a terminal.'] },
      );
    } catch (err) {
      if (err instanceof DevkitError && err.code === 'INPUT_REQUIRED') {
        throw new DevkitError(
          'config',
          'VECTOR_UNTRUSTED',
          `The manifest command for ${input.label} has not been trusted yet: ${shown}`,
          {
            hint: 'A person confirms each manifest-supplied command once per workspace.',
            nextSteps: [
              ...(input.tool ? [recoveryCommand(input, 'tool', 'show', input.tool)] : []),
              'Review the exact arguments above; rerun the original command with --yes only if they are authorized.',
            ],
          },
        );
      }
      throw err;
    }
    if (!ok) {
      throw new DevkitError(
        'permission',
        'VECTOR_REJECTED',
        `The command for ${input.label} was not trusted: ${shown}`,
        {
          hint: 'Nothing ran. Edit the manifest patch, or re-run and confirm.',
          nextSteps: input.tool
            ? [recoveryCommand(input, 'tool', 'show', input.tool)]
            : ['Review the rejected command in the manifest source.'],
        },
      );
    }
  }
}

export function commandTrustHandoff(input: {
  readonly tool: string;
  readonly posture: WritePosture;
  readonly workspace?: string | undefined;
  readonly commandShell?: ResolvedShell | undefined;
}): HandoffEnvelope {
  const command = recoveryCommand(
    input,
    'doctor',
    '--tool',
    input.tool,
    ...(input.posture.readOnly ? ['--allow-writes'] : []),
  );
  return handoffEnvelope({
    summary: `${input.tool} has manifest commands a person has not trusted`,
    userSteps: [
      {
        id: `${input.tool}.trust`,
        kind: 'manual',
        title: `Review ${input.tool} manifest commands`,
        instructions:
          'Run the command in a terminal and confirm only the exact vectors you accept.',
      },
    ],
    command,
    alternatives: [
      recoveryCommand(input, 'tool', 'show', input.tool),
      recoveryCommand(input, 'doctor'),
    ],
  });
}

export function isTrustRequired(err: unknown): boolean {
  return err instanceof DevkitError && isTrustRequiredCode(err.code);
}

// The same answer for a failure that already travels as an envelope.
export function isTrustRequiredCode(code: unknown): boolean {
  return code === 'VECTOR_UNTRUSTED' || code === 'READONLY_BLOCKED';
}
