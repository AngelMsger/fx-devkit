// Select workspace tool requirements from declarations and providers active in the environment scope.

import type { Binding } from '../../domain/manifest/providers.js';
import { finding, type Finding } from '../../domain/report.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { ProviderDescriptor } from '../../ports/provider.js';
import type { WorkspaceContext } from '../workspace-context.js';

import { toolchainOf } from './toolchain.js';

export interface ToolScopeSelection {
  readonly tools?: readonly string[] | undefined;
  readonly envs?: readonly string[] | undefined;
}

export interface WorkspaceToolScope {
  readonly names: readonly string[];
  readonly configuredNames: readonly string[];
  readonly required: ReadonlySet<string>;
  readonly dependencies: ReadonlySet<string>;
  readonly problems: readonly Finding[];
}

export function workspaceToolScope(
  ctx: WorkspaceContext,
  describe: (id: string) => ProviderDescriptor<unknown> | undefined,
  selection: ToolScopeSelection,
): WorkspaceToolScope {
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
            fix: 'fx manifest providers',
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
  for (const name of names.filter((name) => !available.some((tool) => tool.name === name)))
    problems.push(
      finding(
        'tools',
        name,
        'fail',
        'Active provider requires a tool missing from the toolchain.',
        {
          coverage: 'incomplete',
          fix: 'fx manifest validate',
        },
      ),
    );
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
  selection: ToolScopeSelection,
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
