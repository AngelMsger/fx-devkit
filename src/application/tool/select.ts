// Naming tools on the command line: exact names or a correction, never a
// silent subset.

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import { recoveryCommand, type CommandGuidance } from '../workspace/guidance.js';

export function assertToolSelection(names: readonly string[] | undefined, all: boolean): void {
  const named = (names?.length ?? 0) > 0;
  if (named !== all) return;
  throw new DevkitError(
    'usage',
    'BAD_FLAG',
    named ? 'Tool names and --all are mutually exclusive.' : 'Specify tool names or --all.',
    { nextSteps: ['fx tool install --help', 'fx tool update --help'] },
  );
}

export function selectTools(
  tools: readonly ResolvedTool[],
  names: readonly string[] | undefined,
  context: CommandGuidance = {},
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
      nextSteps: [recoveryCommand(context, 'tool', 'list')],
    });
  });
}
