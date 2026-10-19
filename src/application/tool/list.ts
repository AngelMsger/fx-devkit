// The toolchain as rows. `source` says why a tool is here at all — a binding derived it,
// the patch named it, or fx merely knows it; `origin` says who owns its fields, which is
// what tells a reader why a vector might need trust.

import type { Origin } from '../../domain/manifest/overlay.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { ToolSource, ToolSourceKind } from '../../domain/toolchain/select.js';

export interface ToolRow {
  readonly name: string;
  readonly desc: string | null;
  readonly required: boolean;
  readonly enabled: boolean;
  readonly min_version: string | null;
  readonly install_via: string | null;
  readonly origin: Origin | 'mixed';
  readonly source: ToolSourceKind;
  readonly bound_by: readonly string[];
  readonly setup_steps: number;
}

export const TOOL_COLUMNS = [
  'name',
  'source',
  'required',
  'enabled',
  'min_version',
  'install_via',
  'origin',
  'desc',
] as const;

export class ToolList {
  execute(input: {
    readonly tools: readonly ResolvedTool[];
    readonly sources: ReadonlyMap<string, ToolSource>;
  }): ToolRow[] {
    return input.tools.map((tool) => {
      const source = input.sources.get(tool.name);
      return {
        name: tool.name,
        desc: tool.desc ?? null,
        required: tool.required,
        enabled: tool.enabled,
        min_version: tool.minVersion ?? null,
        install_via: tool.install[0]?.via ?? null,
        origin: originOf(tool),
        source: source?.kind ?? 'catalog',
        bound_by: source?.boundBy ?? [],
        setup_steps: tool.setup.length,
      };
    });
  }
}

function originOf(tool: ResolvedTool): ToolRow['origin'] {
  if (tool.patchedFields.length === 0) return 'base';
  return tool.baseFields.length === 0 ? 'patch' : 'mixed';
}
