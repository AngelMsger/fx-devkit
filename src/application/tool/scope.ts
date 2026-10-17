// Which tools a workspace check covers: the ones it declares, plus the ones the providers
// active in the selected environments drive.

import { servesCapability } from '../../domain/manifest/providers.js';
import { finding, type Finding } from '../../domain/report.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import {
  keyedBinding,
  keyedPlatform,
  providerTools,
  type KeyedBinding,
} from '../../domain/toolchain/select.js';
import type { WorkspaceContext } from '../workspace/context.js';
import { workspaceCommand } from '../workspace/guidance.js';

import { declaredIn, toolchainOf } from './toolchain.js';

export interface ToolScopeSelection {
  readonly tools?: readonly string[] | undefined;
  readonly envs?: readonly string[] | undefined;
}

export interface WorkspaceToolScope {
  readonly names: readonly string[];
  readonly configuredNames: readonly string[];
  // The entries behind `configuredNames`, so a check never resolves the toolchain twice and
  // reaches a different answer.
  readonly covered: readonly ResolvedTool[];
  readonly required: ReadonlySet<string>;
  readonly dependencies: ReadonlySet<string>;
  readonly problems: readonly Finding[];
}

export function workspaceToolScope(
  ctx: WorkspaceContext,
  selection: ToolScopeSelection,
  commandShell?: ResolvedShell,
): WorkspaceToolScope {
  // Selection decides what a check covers by default; naming a tool explicitly may still
  // reach one fx only knows, which is why the catalog counts as known here.
  const toolchain = toolchainOf(ctx);
  const available = toolchain.all;
  const known = (tool: string): boolean => available.some((entry) => entry.name === tool);
  const bindings = activeBindings(ctx, selection);
  const dependencies = new Set(
    providerTools(bindings, ctx.providers, declaredIn(available)).keys(),
  );
  const problems: Finding[] = [
    ...unservedBindings(ctx, bindings, declaredIn(available)).map((binding) =>
      finding(
        'manifest',
        `provider:${binding.key}`,
        'fail',
        `Provider "${binding.provider}" ${ctx.providers.some((p) => p.id === binding.provider) ? `does not serve ${binding.capability}` : 'is not registered'}; readiness could not be checked.`,
        {
          coverage: 'incomplete',
          fix: workspaceCommand({ ctx, commandShell }, 'manifest', 'providers'),
          evidence: { provider: binding.provider, capability: binding.capability },
        },
      ),
    ),
  ];
  const names = selection.tools ?? [
    ...new Set([
      ...toolchain.tools.filter((tool) => tool.required || tool.declared).map((tool) => tool.name),
      ...dependencies,
    ]),
  ];
  for (const name of names.filter((name) => !known(name)))
    problems.push(
      finding(
        'tools',
        name,
        'fail',
        'Neither the bundled catalog nor manifest/tools.yaml describes this tool.',
        {
          coverage: 'incomplete',
          fix: workspaceCommand({ ctx, commandShell }, 'tool', 'list', '--catalog'),
        },
      ),
    );
  return {
    names,
    problems,
    configuredNames: names.filter(known),
    covered: available.filter((tool) => names.includes(tool.name)),
    dependencies,
    required: new Set([
      ...(selection.tools ?? []),
      ...available.filter((tool) => isRequired(tool, dependencies)).map((tool) => tool.name),
      ...[...dependencies].filter((name) => !known(name)),
    ]),
  };
}

// A binding fx cannot read: its provider is unregistered and names no tool either, or it is
// registered under a different capability. Either way nothing can be checked for it.
function unservedBindings(
  ctx: WorkspaceContext,
  bindings: readonly KeyedBinding[],
  declaresTool: (tool: string) => boolean,
): KeyedBinding[] {
  return bindings.filter((binding) => {
    if (binding.provider === null || binding.source === 'misplaced') return false;
    const provider = ctx.providers.find((candidate) => candidate.id === binding.provider);
    if (servesCapability(provider, binding.capability)) return false;
    return provider !== undefined || !declaresTool(binding.provider);
  });
}

function activeBindings(ctx: WorkspaceContext, selection: ToolScopeSelection): KeyedBinding[] {
  const environments = Object.entries(ctx.manifest.environments?.result.doc.envs ?? {}).filter(
    ([name]) =>
      (selection.envs === undefined || selection.envs.includes(name)) &&
      (ctx.local.scope?.envs === undefined || ctx.local.scope.envs.includes(name)),
  );
  return [
    ...ctx.bindings.map(keyedBinding),
    ...ctx.platforms
      .filter((binding) =>
        environments.some(([, env]) => env.platforms?.[binding.platform] !== undefined),
      )
      .map(keyedPlatform),
  ];
}

function isRequired(tool: ResolvedTool, dependencies: ReadonlySet<string>): boolean {
  return (
    tool.required ||
    (tool.enabled && tool.installOnInit === true) ||
    (dependencies.has(tool.name) && !tool.patchedFields.includes('required'))
  );
}
