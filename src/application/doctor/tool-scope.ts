// Doctor checks declared tools and providers used by the selected workspace/environment scope.

import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { LoginDeps } from '../login/deps.js';
import type { SetupSelection } from '../login/selection.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceContext } from '../workspace-context.js';

export interface DoctorToolScope {
  readonly names: readonly string[];
  readonly configuredNames: readonly string[];
  readonly required: ReadonlySet<string>;
  readonly dependencies: ReadonlySet<string>;
}

export function doctorToolScope(
  ctx: WorkspaceContext,
  describe: LoginDeps['describeProvider'],
  selection: SetupSelection,
): DoctorToolScope {
  const environments = Object.entries(ctx.manifest.environments?.result.doc.envs ?? {}).filter(
    ([name]) =>
      (selection.envs === undefined || selection.envs.includes(name)) &&
      (ctx.local.scope?.envs === undefined || ctx.local.scope.envs.includes(name)),
  );
  const activePlatforms = ctx.platforms.filter((binding) =>
    environments.some(([, env]) => env.platforms?.[binding.platform] !== undefined),
  );
  const dependencies = new Set(
    [...ctx.bindings, ...activePlatforms].flatMap((binding) =>
      binding.provider === null || binding.source === 'misplaced'
        ? []
        : (describe(binding.provider)?.tools ?? []),
    ),
  );
  const available = toolchainOf(ctx).tools;
  const names = selection.tools ?? [
    ...new Set([
      ...available
        .filter((tool) => tool.required || tool.patchedFields.length > 0)
        .map((tool) => tool.name),
      ...dependencies,
    ]),
  ];
  return {
    names,
    configuredNames: names.filter((name) => available.some((tool) => tool.name === name)),
    dependencies,
    required: new Set([
      ...available.filter((tool) => isRequired(tool, dependencies)).map((tool) => tool.name),
      ...[...dependencies].filter((name) => !available.some((tool) => tool.name === name)),
    ]),
  };
}

function isRequired(tool: ResolvedTool, dependencies: ReadonlySet<string>): boolean {
  return tool.required || (dependencies.has(tool.name) && !tool.patchedFields.includes('required'));
}
