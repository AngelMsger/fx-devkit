// Which of the catalog's tools a workspace actually has. fx assumes no tool: a tool is in
// the toolchain because a bound provider drives it, or because the team's patch named it.
// Everything else stays in the catalog, known but unselected.

import {
  servesCapability,
  type Binding,
  type PlatformBinding,
  type ProviderCatalog,
  type ProviderFacts,
} from '../manifest/providers.js';

import type { ResolvedTool } from './resolve.js';

// A binding identified the way reports name it: the capability, or the platform instance
// within it.
export interface KeyedBinding extends Binding {
  readonly key: string;
}

export function keyedBinding(binding: Binding): KeyedBinding {
  return { ...binding, key: binding.capability };
}

export function keyedPlatform(binding: PlatformBinding): KeyedBinding {
  return { ...binding, key: `${binding.capability}:${binding.platform}` };
}

export type ToolSourceKind = 'binding' | 'manifest' | 'catalog';

export interface ToolSource {
  readonly kind: ToolSourceKind;
  // The bindings that pulled the tool in, in the order they were read.
  readonly boundBy: readonly string[];
}

export interface SelectedToolchain {
  readonly tools: readonly ResolvedTool[];
  readonly catalog: readonly ResolvedTool[];
  // Both of the above in document order, for the readers that answer about any tool fx
  // knows rather than only the ones this workspace selected.
  readonly all: readonly ResolvedTool[];
  readonly sources: ReadonlyMap<string, ToolSource>;
}

// The tools each binding needs, keyed by tool name. A provider fx does not know is read as
// one the manifest defines itself, named after the tool it drives — but only where the team
// declared that tool, because fx's own catalog names are tools, not provider ids, and an id
// that merely resembles one is a mistake worth correcting rather than obeying.
export function providerTools(
  bindings: readonly KeyedBinding[],
  providers: ProviderCatalog,
  declaresTool: (tool: string) => boolean,
): ReadonlyMap<string, readonly string[]> {
  const needed = new Map<string, string[]>();
  for (const binding of bindings) {
    if (binding.provider === null || binding.source === 'misplaced') continue;
    const provider = providers.find((candidate) => candidate.id === binding.provider);
    for (const tool of toolsOf(provider, binding, declaresTool))
      needed.set(tool, [...(needed.get(tool) ?? []), binding.key]);
  }
  return needed;
}

function toolsOf(
  provider: ProviderFacts | undefined,
  binding: KeyedBinding,
  declaresTool: (tool: string) => boolean,
): readonly string[] {
  if (servesCapability(provider, binding.capability)) return provider.tools;
  const own = binding.provider;
  return provider === undefined && own !== null && declaresTool(own) ? [own] : [];
}

export function selectToolchain(
  resolved: readonly ResolvedTool[],
  needed: ReadonlyMap<string, readonly string[]>,
): SelectedToolchain {
  const sources = new Map<string, ToolSource>();
  const tools: ResolvedTool[] = [];
  const catalog: ResolvedTool[] = [];
  for (const tool of resolved) {
    const boundBy = needed.get(tool.name) ?? [];
    // A tool both bound and declared reads as bound: dropping the declaration would leave
    // it in the toolchain, so the binding is why it is here.
    const kind = kindOf(boundBy.length > 0, tool.declared);
    sources.set(tool.name, { kind, boundBy });
    (kind === 'catalog' ? catalog : tools).push(tool);
  }
  return { tools, catalog, all: resolved, sources };
}

function kindOf(bound: boolean, declared: boolean): ToolSourceKind {
  if (bound) return 'binding';
  return declared ? 'manifest' : 'catalog';
}
