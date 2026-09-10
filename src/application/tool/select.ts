// Naming tools on the command line: exact names or a correction, never a
// silent subset.

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';

export function selectTools(
  tools: readonly ResolvedTool[],
  names: readonly string[] | undefined,
): ResolvedTool[] {
  if (names === undefined) return [...tools];
  return names.map((name) => {
    const tool = tools.find((t) => t.name === name);
    if (tool !== undefined) return tool;
    const suggestion = nearest(
      name,
      tools.map((t) => t.name),
    );
    throw new DevkitError('not_found', 'TOOL_UNKNOWN', `no tool named "${name}" in the toolchain`, {
      hint:
        suggestion === undefined
          ? 'fx tool list shows the known tools.'
          : `Did you mean "${suggestion}"?`,
      nextSteps: ['fx tool list'],
    });
  });
}
