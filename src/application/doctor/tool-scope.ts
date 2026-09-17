// Doctor checks declared tools and providers used by the selected workspace/environment scope.

import type { Binding } from '../../domain/manifest/providers.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { LoginDeps } from '../login/deps.js';
import type { SetupSelection } from '../login/selection.js';
import { toolchainOf } from '../tool/toolchain.js';
import { workspaceCommand } from '../workspace/guidance.js';
import type { WorkspaceContext } from '../workspace-context.js';

import { finding, type Finding } from './types.js';

export interface DoctorToolScope {
  readonly names: readonly string[];
  readonly configuredNames: readonly string[];
  readonly required: ReadonlySet<string>;
  readonly dependencies: ReadonlySet<string>;
  readonly problems: readonly Finding[];
}

export function doctorToolScope(
  ctx: WorkspaceContext,
  describe: LoginDeps['describeProvider'],
  selection: SetupSelection,
  commandShell?: ResolvedShell,
): DoctorToolScope {
  const problems: Finding[] = [];
  const dependencies = new Set<string>();
  for (const binding of activeBindings(ctx, selection)) {
    if (binding.provider === null || binding.source === 'misplaced') continue;
    const provider = describe(binding.provider);
    if (provider === undefined || provider.capability !== binding.capability) {
      problems.push(
        finding(
          'manifest',
          `provider:${binding.key}`,
          'fail',
          `Provider "${binding.provider}" ${provider === undefined ? 'is not registered' : `does not serve ${binding.capability}`}; readiness could not be checked.`,
          {
            coverage: 'incomplete',
            fix: workspaceCommand({ ctx, commandShell }, 'manifest', 'providers'),
            evidence: { provider: binding.provider, capability: binding.capability },
          },
        ),
      );
    } else for (const tool of provider.tools) dependencies.add(tool);
  }
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
    problems,
    configuredNames: names.filter((name) => available.some((tool) => tool.name === name)),
    dependencies,
    required: new Set([
      ...available.filter((tool) => isRequired(tool, dependencies)).map((tool) => tool.name),
      ...[...dependencies].filter((name) => !available.some((tool) => tool.name === name)),
    ]),
  };
}

function activeBindings(
  ctx: WorkspaceContext,
  selection: SetupSelection,
): (Binding & { key: string })[] {
  const environments = Object.entries(ctx.manifest.environments?.result.doc.envs ?? {}).filter(
    ([name]) =>
      (selection.envs === undefined || selection.envs.includes(name)) &&
      (ctx.local.scope?.envs === undefined || ctx.local.scope.envs.includes(name)),
  );
  return [
    ...ctx.bindings.map((binding) => ({ ...binding, key: binding.capability })),
    ...ctx.platforms
      .filter((binding) =>
        environments.some(([, env]) => env.platforms?.[binding.platform] !== undefined),
      )
      .map((binding) => ({ ...binding, key: `${binding.capability}:${binding.platform}` })),
  ];
}

function isRequired(tool: ResolvedTool, dependencies: ReadonlySet<string>): boolean {
  return tool.required || (dependencies.has(tool.name) && !tool.patchedFields.includes('required'));
}
