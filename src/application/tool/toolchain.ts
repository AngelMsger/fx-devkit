// The resolved toolchain a tool command works on. Inside a workspace the tools are the ones
// its bindings need and its patch names; outside one there is nothing to derive from, so
// the bundled catalog stands in whole.

import { loadTools } from '../../domain/manifest/loader.js';
import { resolveTools, type ResolvedTool } from '../../domain/toolchain/resolve.js';
import {
  keyedBinding,
  keyedPlatform,
  providerTools,
  selectToolchain,
  type KeyedBinding,
  type ToolSource,
} from '../../domain/toolchain/select.js';
import type { ManifestBundle } from '../manifest/load.js';
import type { WorkspaceContext } from '../workspace-context.js';

export interface Toolchain {
  readonly tools: readonly ResolvedTool[];
  // Known to this fx, but selected by nothing in this workspace.
  readonly catalog: readonly ResolvedTool[];
  readonly all: readonly ResolvedTool[];
  readonly sources: ReadonlyMap<string, ToolSource>;
  readonly workspace: string | undefined;
}

export function toolchainOf(ctx: WorkspaceContext): Toolchain {
  const resolved = toolsOf(ctx.manifest);
  const needed = providerTools(boundToolchain(ctx), ctx.providers, declaredIn(resolved));
  return { ...selectToolchain(resolved, needed), workspace: ctx.name };
}

// Installing is a machine-wide act, so the toolchain spans every environment the manifest
// declares. Narrowing to the selected ones belongs to the checks that run per environment.
export function boundToolchain(ctx: WorkspaceContext): KeyedBinding[] {
  return [...ctx.bindings.map(keyedBinding), ...ctx.platforms.map(keyedPlatform)];
}

export function declaredIn(tools: readonly ResolvedTool[]): (tool: string) => boolean {
  return (tool) => tools.some((entry) => entry.name === tool && entry.declared);
}

export function toolsOf(bundle: ManifestBundle): readonly ResolvedTool[] {
  const { doc, provenance, declared } = bundle.tools.result;
  return resolveTools(doc, provenance, declared);
}

export function bundledToolchain(bundledText: string, cliVersion: string): Toolchain {
  const { doc, provenance, declared } = loadTools(bundledText, undefined, { cliVersion });
  const tools = resolveTools(doc, provenance, declared);
  return {
    tools,
    catalog: [],
    all: tools,
    sources: new Map(tools.map((tool) => [tool.name, { kind: 'catalog', boundBy: [] }])),
    workspace: undefined,
  };
}
