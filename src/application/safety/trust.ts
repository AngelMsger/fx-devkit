// The gate every manifest-supplied command vector passes before it runs.
// Bundled defaults are trusted by construction; a team patch is trusted
// once a person has seen the exact vector and said yes (or passed --yes),
// and the fingerprint is remembered for that workspace.

import { DevkitError, handoffEnvelope, type HandoffEnvelope } from '../../domain/errors.js';
import {
  trustFingerprint,
  renderTrustContext,
  renderVector,
  type TrustExecution,
} from '../../domain/toolchain/trust.js';
import type { Clock } from '../../ports/clock.js';
import type { Prompter } from '../../ports/prompter.js';
import type { TrustStore } from '../../ports/stores.js';

import { assertWritable, type WritePosture } from './posture.js';

export interface TrustInput {
  readonly workspace: string;
  readonly vector: readonly string[];
  readonly label: string;
  readonly execution?: TrustExecution | undefined;
  readonly origin: 'base' | 'patch';
  readonly yes: boolean;
  readonly posture: WritePosture;
}

// What a use case carries when patch-supplied vectors may run on its path.
// Under a dry run nothing is recorded: an untrusted vector is reported, not
// asked about.
export interface TrustContext {
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
    if (await this.isTrusted(input)) return;
    assertWritable(input.posture, `trust ${input.label}`);
    if (!input.yes) await this.confirm(input);
    await this.store.trust(input.workspace, trustFingerprint(input), input.label);
  }

  async isTrusted(
    input: Pick<TrustInput, 'workspace' | 'vector' | 'origin' | 'execution'>,
  ): Promise<boolean> {
    if (input.origin === 'base') return true;
    return this.store.isTrusted(input.workspace, trustFingerprint(input));
  }

  private async confirm(input: TrustInput): Promise<void> {
    const shown = renderVector(input.vector) + renderTrustContext(input.execution);
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
          `the manifest command for ${input.label} has not been trusted yet: ${shown}`,
          {
            hint: 'A person confirms each manifest-supplied command once per workspace.',
            nextSteps: [
              'Re-run the same command in a terminal and review the vector.',
              'fx tool show <tool>',
              `Review the manifest patch that defines ${input.label}.`,
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
        `the command for ${input.label} was not trusted: ${shown}`,
        {
          hint: 'Nothing ran. Edit the manifest patch, or re-run and confirm.',
          nextSteps: ['fx tool show <tool>'],
        },
      );
    }
  }
}

export function commandTrustHandoff(input: {
  readonly tool: string;
  readonly posture: WritePosture;
}): HandoffEnvelope {
  const base = `fx doctor --tool ${input.tool}`;
  const command = input.posture.readOnly ? `${base} --allow-writes` : base;
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
    alternatives: [`fx tool show ${input.tool}`, 'fx doctor'],
  });
}

export function isTrustRequired(err: unknown): boolean {
  return (
    err instanceof DevkitError &&
    (err.code === 'VECTOR_UNTRUSTED' || err.code === 'READONLY_BLOCKED')
  );
}
