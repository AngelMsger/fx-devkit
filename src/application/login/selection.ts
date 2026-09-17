// Explicit selectors must name declared tools and environments before a setup
// workflow prompts, repairs or filters checks. A valid tool may have no recipe.

import type { ResolvedShell } from '../../domain/shell.js';
import { envNotFound } from '../env/names.js';
import { selectTools } from '../tool/select.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceContext } from '../workspace-context.js';

export interface SetupSelection {
  readonly tools?: readonly string[] | undefined;
  readonly envs?: readonly string[] | undefined;
}

export function validateSetupSelection(
  ctx: WorkspaceContext,
  selection: SetupSelection,
  commandShell?: ResolvedShell,
): void {
  selectTools(toolchainOf(ctx).tools, selection.tools, { workspace: ctx.name, commandShell });
  const known = Object.keys(ctx.manifest.environments?.result.doc.envs ?? {});
  for (const name of selection.envs ?? []) {
    if (!known.includes(name)) throw envNotFound({ ctx, commandShell }, name, known);
  }
}
