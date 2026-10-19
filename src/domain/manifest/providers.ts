// Which provider fulfils each capability, read off the two documents that bind them and
// the catalog this fx ships. A schema 1 document names no providers, so its git host and
// its platform names imply one through what the providers themselves declare. Whether a
// binding can be served is answered against the providers the registry hands in.

import { capabilitiesInScope, type Capability, type CapabilityName } from '../capability.js';
import { DevkitError } from '../errors.js';
import { nearest, suggestionHint } from '../fuzzy.js';

import {
  serviceVars,
  type AuthScheme,
  type ServiceField,
  type ServiceSettings,
} from './service.schema.js';
import type { Environments, Workspace } from './types.js';

// The shared service settings a provider accepts in a manifest, and the authentication
// methods it can use. A provider without one takes no service block at all.
export interface ServiceContract {
  readonly fields: readonly ServiceField[];
  readonly authSchemes?: readonly AuthScheme[];
}

// What reading a manifest needs to know about a provider. `ProviderDescriptor` carries
// these, so the adapter that implements a provider is also the one that declares them.
export interface ProviderFacts {
  readonly id: string;
  readonly capability: Capability;
  // The companion CLIs this provider drives. A workspace's toolchain is read off its
  // bindings, so which tools a provider needs is part of reading its manifest.
  readonly tools: readonly string[];
  readonly settings?: ServiceContract;
  // A schema 1 workspace writes `defaults.host` and no provider: this one stands in.
  readonly impliedByDefaultHost?: true;
  // Platform names a schema 1 environments document uses in place of this provider's id.
  readonly impliedByPlatform?: readonly string[];
}

export type ProviderCatalog = readonly ProviderFacts[];

// A binding names a provider by id, so the descriptor that id resolves to still has to be
// the one registered under the capability being bound.
export function providerForPlatform(
  providers: ProviderCatalog | undefined,
  platform: string,
): ProviderFacts | undefined {
  return providers?.find((provider) => provider.impliedByPlatform?.includes(platform));
}

export function servesCapability<P extends ProviderFacts>(
  provider: P | undefined,
  capability: CapabilityName,
): provider is P {
  return provider?.capability === capability;
}

export type BindingSource = 'explicit' | 'default' | 'unbound' | 'misplaced';

export interface Binding {
  readonly capability: CapabilityName;
  readonly provider: string | null;
  readonly source: BindingSource;
  readonly vars: Readonly<Record<string, string>>;
  readonly service?: ServiceSettings;
}

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

// fx reaches for the code host in several workflows; naming the capability once
// keeps the word out of the callers that only want the binding.
export function codeHostBinding(bindings: readonly Binding[]): Binding {
  return bindingOf(bindings, 'code-host');
}

export function bindProviders(workspace: Workspace, providers: ProviderCatalog): Binding[] {
  const explicit = workspace.providers ?? {};
  const implied = providers.find((provider) => provider.impliedByDefaultHost);
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
    if (implied?.capability === capability && workspace.defaults.host !== undefined) {
      return {
        capability,
        provider: implied.id,
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

// The platform instance a binding belongs to; a workspace-wide binding has none.
export function platformOf(binding: Binding | PlatformBinding): string | null {
  return 'platform' in binding ? binding.platform : null;
}

export function bindPlatforms(
  environments: Environments | undefined,
  providers: ProviderCatalog,
): PlatformBinding[] {
  if (environments === undefined) return [];
  return Object.entries(environments.platforms).map(([platform, spec]) => {
    const vars = { ...spec.vars, ...serviceVars(spec.service) };
    const service = spec.service ? { service: spec.service } : {};
    if (spec.provider !== undefined) {
      return {
        platform,
        capability:
          spec.capability ?? providerForPlatform(providers, platform)?.capability ?? 'unknown',
        provider: spec.provider,
        source: 'explicit',
        vars,
        ...service,
      };
    }
    const fallback = providerForPlatform(providers, platform);
    if (fallback !== undefined)
      return {
        platform,
        provider: fallback.id,
        capability: fallback.capability,
        source: 'default',
        vars,
        ...service,
      };
    return {
      platform,
      capability: spec.capability ?? 'unknown',
      provider: null,
      source: 'unbound',
      vars,
    };
  });
}

export interface VarSpec {
  readonly name: string;
  readonly desc: string;
  readonly required: boolean;
}

// What resolving a binding reads from a provider: its facts and the variables it takes.
export interface BindableProvider extends ProviderFacts {
  readonly vars: readonly VarSpec[];
}

// The registered provider a binding names, once it serves the bound capability and the
// binding supplies every variable it requires.
export function requireProvider<P extends BindableProvider>(
  binding: Binding | PlatformBinding,
  registered: readonly P[],
): P {
  const { capability } = binding;
  const ids = registered.filter((p) => p.capability === capability).map((p) => p.id);
  const available = `Available: ${ids.join(', ') || '(none)'}.`;
  if (binding.provider === null)
    throw new DevkitError('config', 'PROVIDER_UNBOUND', `No provider is bound for ${capability}`, {
      hint: `Add \`providers.${capability}\` to manifest/workspace.yaml. ${available}`,
      nextSteps: ['fx manifest providers', 'fx manifest explain providers'],
    });
  const named = binding.provider;
  const provider = registered.find((candidate) => candidate.id === named);
  if (!servesCapability(provider, capability))
    throw new DevkitError(
      'config',
      'PROVIDER_UNKNOWN',
      `"${named}" is not a ${capability} provider this fx knows`,
      {
        hint: suggestionHint(nearest(named, ids), available),
        nextSteps: ['fx manifest providers', 'fx --version'],
      },
    );
  const missing = provider.vars.filter((v) => v.required && !binding.vars[v.name]?.trim());
  if (missing.length > 0)
    throw new DevkitError(
      'config',
      'PROVIDER_VAR_MISSING',
      `providers.${capability} (${provider.id}) is missing ${missing.map((v) => v.name).join(', ')}`,
      {
        hint: missing.map((v) => `${v.name}: ${v.desc}`).join('; '),
        nextSteps: ['fx manifest explain providers'],
      },
    );
  return provider;
}
