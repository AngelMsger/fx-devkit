// Report readiness and recovery for a resolved capability or tool.

import { DevkitError } from '../domain/errors.js';
import { shellLine } from '../domain/shell.js';

import type { LoginDeps } from './login/deps.js';
import { Readiness, type Verdict } from './readiness.js';
import type { Target } from './readiness.js';
import type { WorkspaceDeps } from './workspace/deps.js';
import { workspaceCommand } from './workspace/guidance.js';

export interface CanInput {
  readonly target: string;
  readonly agent?: string | undefined;
  readonly env?: string | undefined;
}

export interface CanResult extends Verdict {
  readonly capability: string | null;
  readonly tool: string | null;
  readonly provider: string | null;
  readonly env: string | null;
  readonly entry?: {
    readonly label: string;
    readonly command: string;
    readonly url: string | null;
  };
}

export class Can {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
  ) {}

  async execute(input: CanInput): Promise<CanResult> {
    if (input.agent)
      throw new DevkitError('usage', 'BAD_FLAG', '--agent is only valid for mcp:<name>.', {
        nextSteps: ['fx can --help'],
      });
    const readiness = new Readiness(this.deps, this.login);
    const target = readiness.resolve(input.target, input.env);
    const env = input.env ?? null;
    const entry = this.entry(target);
    return {
      capability: target.capability,
      tool: target.tool?.name ?? null,
      provider: target.binding?.provider ?? null,
      env,
      ...(entry === undefined ? {} : { entry }),
      ...(await readiness.judge(target, env)),
    };
  }

  private entry(target: Target): CanResult['entry'] {
    const binding = target.binding;
    if (binding === null || binding.provider === null) return undefined;
    const descriptor = this.login.describeProvider(binding.provider);
    if (descriptor === undefined || descriptor.capability !== binding.capability)
      throw new DevkitError(
        'config',
        'PROVIDER_UNKNOWN',
        `No matching provider for ${binding.capability}: ${binding.provider}`,
        {
          nextSteps: [workspaceCommand(this.deps, 'manifest', 'providers')],
        },
      );
    if (!descriptor.reference) return undefined;
    const coordinate = this.deps.reference(binding);
    return {
      label: coordinate.label,
      command: shellLine(coordinate.command, this.deps.commandShell),
      url: coordinate.url ?? null,
    };
  }
}
