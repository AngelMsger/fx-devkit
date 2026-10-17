// Report readiness and recovery for a resolved capability or tool; without a
// target, list what there is to ask about.

import {
  CAPABILITY_INFO,
  bindableCapabilities,
  type Capability,
  type CapabilityScope,
} from '../../domain/capability.js';
import { DevkitError } from '../../domain/errors.js';
import {
  bindingOf,
  servesCapability,
  type Binding,
  type PlatformBinding,
} from '../../domain/manifest/providers.js';
import { shellLine } from '../../domain/shell.js';
import type { LoginDeps } from '../login/deps.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

import type { Target, Verdict } from './types.js';

import { Readiness } from './index.js';

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

export interface CapabilityRow {
  readonly capability: Capability;
  readonly scope: CapabilityScope;
  readonly platform: string | null;
  readonly provider: string | null;
  readonly tool: string | null;
  readonly desc: string;
}

export const CAPABILITY_COLUMNS = [
  'capability',
  'scope',
  'platform',
  'provider',
  'tool',
  'desc',
] as const;

export class Can {
  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly login: LoginDeps,
  ) {}

  async execute(input: CanInput): Promise<CanResult> {
    if (input.agent)
      throw new DevkitError('usage', 'BAD_FLAG', '--agent is only valid for mcp:<name>', {
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

  // Every capability a manifest binds and what serves it here. Bindings only: a row
  // names who would answer, and asking about that capability says whether they can.
  list(input: Omit<CanInput, 'target'>): CapabilityRow[] {
    if (input.agent || input.env)
      throw new DevkitError('usage', 'BAD_FLAG', '--env and --agent need a target', {
        hint: 'Without a target, can lists the capabilities of the whole workspace.',
        nextSteps: [workspaceCommand(this.deps, 'can'), 'fx can --help'],
      });
    const readiness = new Readiness(this.deps, this.login);
    return bindableCapabilities().flatMap((capability) =>
      this.bindingsOf(capability).map((binding) => ({
        capability,
        scope: CAPABILITY_INFO[capability].scope,
        platform: 'platform' in binding ? binding.platform : null,
        provider: binding.provider,
        tool: readiness.targetOf(binding)?.tool?.name ?? null,
        desc: CAPABILITY_INFO[capability].desc,
      })),
    );
  }

  // One binding for a workspace-scoped capability, one per platform instance for an
  // environment-scoped one; nothing bound still reads as a row without a provider.
  private bindingsOf(capability: Capability): readonly (Binding | PlatformBinding)[] {
    const { bindings, platforms } = this.deps.ctx;
    if (CAPABILITY_INFO[capability].scope === 'workspace') return [bindingOf(bindings, capability)];
    const instances = platforms.filter((binding) => binding.capability === capability);
    return instances.length > 0 ? instances : [bindingOf([], capability)];
  }

  // A provider fx does not implement is still usable when the manifest describes a tool of
  // that name: fx has no entry coordinate to offer, but the tool's own readiness answers the
  // question. Without such a tool the binding names nothing at all.
  private entry(target: Target): CanResult['entry'] {
    const binding = target.binding;
    if (binding === null || binding.provider === null) return undefined;
    const descriptor = this.login.describeProvider(binding.provider);
    if (!servesCapability(descriptor, binding.capability)) {
      if (descriptor === undefined && target.tool !== null) return undefined;
      throw new DevkitError(
        'config',
        'PROVIDER_UNKNOWN',
        `No matching provider for ${binding.capability}: ${binding.provider}`,
        {
          nextSteps: [workspaceCommand(this.deps, 'manifest', 'providers')],
        },
      );
    }
    if (!descriptor.reference) return undefined;
    const coordinate = this.deps.reference(binding);
    return {
      label: coordinate.label,
      command: shellLine(coordinate.command, this.deps.commandShell),
      url: coordinate.url ?? null,
    };
  }
}
