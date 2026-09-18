// Which provider fulfils each capability, read off the two documents that bind them. A
// schema 1 document names no providers: its git host implies the default code host and a
// platform's name implies the family tool that serves it. Whether a provider id names a
// real adapter is the registry's business.

import { capabilitiesInScope, type Capability } from '../capability.js';

import { serviceVars, type ServiceSettings } from './service.schema.js';
import type { Environments, Workspace } from './types.js';

export type BindingSource = 'explicit' | 'default' | 'unbound' | 'misplaced';

export interface Binding {
  readonly capability: Capability | string;
  readonly provider: string | null;
  readonly source: BindingSource;
  readonly vars: Readonly<Record<string, string>>;
  readonly service?: ServiceSettings;
}

const DEFAULT_CODE_HOST = 'bitbucket-cli';

// A capability that the bound set does not mention reads as an explicit absence,
// so resolution reports it with its recovery steps instead of failing on nothing.
export function bindingOf(bindings: readonly Binding[], capability: Capability): Binding {
  return (
    bindings.find((binding) => binding.capability === capability) ?? {
      capability,
      provider: null,
      source: 'unbound',
      vars: {},
    }
  );
}

export function bindProviders(workspace: Workspace): Binding[] {
  const explicit = workspace.providers ?? {};
  const bindings: Binding[] = capabilitiesInScope('workspace').map((capability) => {
    const bound = explicit[capability];
    if (bound !== undefined) {
      return {
        capability,
        provider: bound.provider,
        source: 'explicit',
        vars: {
          ...bound.vars,
          ...serviceVars(bound.service),
          ...(bound.vars?.['host'] ? { host: bound.vars['host'] } : {}),
        },
        ...(bound.service ? { service: bound.service } : {}),
      };
    }
    if (capability === 'code-host' && workspace.defaults.host !== undefined) {
      return {
        capability,
        provider: DEFAULT_CODE_HOST,
        source: 'default',
        vars: { host: workspace.defaults.host },
      };
    }
    return { capability, provider: null, source: 'unbound', vars: {} };
  });
  const workspaceScoped = new Set<string>(capabilitiesInScope('workspace'));
  for (const [capability, bound] of Object.entries(explicit)) {
    if (workspaceScoped.has(capability)) continue;
    bindings.push({
      capability,
      provider: bound.provider,
      source: 'misplaced',
      vars: bound.vars ?? {},
    });
  }
  return bindings;
}

export interface PlatformBinding extends Binding {
  readonly platform: string;
}

export const PLATFORM_DEFAULTS: Readonly<
  Record<string, { readonly provider: string; readonly capability: Capability }>
> = {
  sentry: { provider: 'sentry', capability: 'error-tracker' },
  openobserve: { provider: 'openobserve-cli', capability: 'log-store' },
  jenkins: { provider: 'jenkins-cli', capability: 'ci' },
  kube: { provider: 'kubectl', capability: 'cluster' },
};

export function bindPlatforms(environments: Environments | undefined): PlatformBinding[] {
  if (environments === undefined) return [];
  return Object.entries(environments.platforms).map(([platform, spec]) => {
    const vars = { ...spec.vars, ...serviceVars(spec.service) };
    const service = spec.service ? { service: spec.service } : {};
    if (spec.provider !== undefined) {
      return {
        platform,
        capability: spec.capability ?? PLATFORM_DEFAULTS[platform]?.capability ?? 'unknown',
        provider: spec.provider,
        source: 'explicit',
        vars,
        ...service,
      };
    }
    const fallback = PLATFORM_DEFAULTS[platform];
    if (fallback !== undefined)
      return { platform, ...fallback, source: 'default', vars, ...service };
    return {
      platform,
      capability: spec.capability ?? 'unknown',
      provider: null,
      source: 'unbound',
      vars,
    };
  });
}
