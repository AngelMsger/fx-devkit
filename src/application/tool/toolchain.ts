// The resolved toolchain a tool command works on: the workspace's merged
// document when there is a workspace, the bundled baseline otherwise.

import { loadTools } from '../../domain/manifest/loader.js';
import { resolveTools, type ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { ManifestBundle } from '../manifest/load.js';
import type { WorkspaceContext } from '../workspace-context.js';

export interface Toolchain {
  readonly tools: readonly ResolvedTool[];
  readonly workspace: string | undefined;
}

export function toolchainOf(ctx: WorkspaceContext): Toolchain {
  return { tools: toolsOf(ctx.manifest), workspace: ctx.name };
}

export function toolsOf(bundle: ManifestBundle): readonly ResolvedTool[] {
  const { doc, provenance } = bundle.tools.result;
  return resolveTools(doc, provenance);
}

export function bundledToolchain(bundledText: string, cliVersion: string): Toolchain {
  const { doc, provenance } = loadTools(bundledText, undefined, { cliVersion });
  return { tools: resolveTools(doc, provenance), workspace: undefined };
}
