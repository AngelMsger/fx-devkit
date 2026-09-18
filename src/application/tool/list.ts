// The toolchain as rows. `origin` says whether an entry is the bundled baseline,
// the team's patch or both — which is what tells a reader why a vector might
// need trust.

import type { ResolvedTool } from '../../domain/toolchain/resolve.js';

export interface ToolRow {
  readonly name: string;
  readonly desc: string | null;
  readonly required: boolean;
  readonly enabled: boolean;
  readonly min_version: string | null;
  readonly install_via: string | null;
  readonly origin: 'base' | 'patch' | 'mixed';
  readonly setup_steps: number;
}

export const TOOL_COLUMNS = [
  'name',
  'required',
  'enabled',
  'min_version',
  'install_via',
  'origin',
  'desc',
] as const;

export class ToolList {
  execute(input: { readonly tools: readonly ResolvedTool[] }): ToolRow[] {
    return input.tools.map((tool) => {
      return {
        name: tool.name,
        desc: tool.desc ?? null,
        required: tool.required,
        enabled: tool.enabled,
        min_version: tool.minVersion ?? null,
        install_via: tool.install[0]?.via ?? null,
        origin: originOf(tool),
        setup_steps: tool.setup.length,
      };
    });
  }
}

function originOf(tool: ResolvedTool): ToolRow['origin'] {
  if (tool.patchedFields.length === 0) return 'base';
  return tool.baseFields.length === 0 ? 'patch' : 'mixed';
}
