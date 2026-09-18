// Which capability or tool a name refers to, and which binding serves it. A name
// that matches nothing, or an environment-scoped capability with more than one
// binding, is a usage error: the question itself has no single answer.

import {
  CAPABILITIES,
  CAPABILITY_INFO,
  knownCapability,
  type Capability,
} from '../../domain/capability.js';
import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import type { Binding, PlatformBinding } from '../../domain/manifest/providers.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import { environmentsOf, envNotFound } from '../env/names.js';
import type { LoginDeps } from '../login/deps.js';
import { toolchainOf } from '../tool/toolchain.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

import type { Target } from './types.js';

export function resolveTarget(
  deps: WorkspaceDeps,
  login: LoginDeps,
  name: string,
  env: string | undefined,
): Target {
  const tools = toolchainOf(deps.ctx).tools;
  const named = knownCapability(name);
  if (named !== null) {
    const capability = named;
    const binding = bindingFor(deps, capability, env);
    if (binding === null) throw capabilityUnbound(deps, capability, env);
    const served = toolOf(deps, login, binding);
    if (served.kind === 'unbound') throw capabilityUnbound(deps, capability, env);
    if (served.kind === 'undeclared') throw toolUndeclared(deps, capability, served);
    return { capability, tool: served.kind === 'tool' ? served.tool : null, binding };
  }
  const tool = tools.find((t) => t.name === name);
  if (tool !== undefined)
    return { capability: null, tool, binding: bindingDriving(deps, login, tool.name, env) };
  const suggestion = nearest(name, [...CAPABILITIES, ...tools.map((t) => t.name)]);
  throw new DevkitError(
    'not_found',
    'CAN_UNKNOWN',
    `"${name}" is neither a capability nor a tool`,
    {
      hint:
        suggestion === undefined
          ? `Capabilities: ${CAPABILITIES.join(', ')}.`
          : `Did you mean "${suggestion}"?`,
      nextSteps: [
        workspaceCommand(deps, 'manifest', 'providers'),
        workspaceCommand(deps, 'tool', 'list'),
      ],
    },
  );
}

export function targetOfBinding(
  deps: WorkspaceDeps,
  login: LoginDeps,
  binding: PlatformBinding,
): Target | null {
  const served = toolOf(deps, login, binding);
  if (served.kind === 'unbound' || served.kind === 'undeclared') return null;
  return {
    capability: knownCapability(binding.capability),
    tool: served.kind === 'tool' ? served.tool : null,
    binding,
  };
}

// Which companion tool a binding reaches, or why it reaches none. A provider that
// is bound and registered but whose tool no toolchain document declares is a
// different answer from a capability nothing is bound to.
type ServedTool =
  | { readonly kind: 'tool'; readonly tool: ResolvedTool }
  | { readonly kind: 'toolless' }
  | { readonly kind: 'unbound' }
  | { readonly kind: 'undeclared'; readonly provider: string; readonly name: string };

// A family provider is named after its tool; the descriptor may say otherwise.
function toolOf(
  deps: WorkspaceDeps,
  login: LoginDeps,
  binding: Binding | PlatformBinding,
): ServedTool {
  const provider = binding.provider;
  if (provider === null) return { kind: 'unbound' };
  const descriptor = login.describeProvider(provider);
  if (descriptor?.capability === binding.capability && descriptor.tools.length === 0)
    return { kind: 'toolless' };
  const name = descriptor?.tools[0] ?? provider;
  const tool = toolchainOf(deps.ctx).tools.find((t) => t.name === name);
  return tool === undefined ? { kind: 'undeclared', provider, name } : { kind: 'tool', tool };
}

function capabilityUnbound(
  deps: WorkspaceDeps,
  capability: Capability,
  env: string | undefined,
): DevkitError {
  return new DevkitError(
    'config',
    'CAPABILITY_UNBOUND',
    `No provider serves ${capability}${env === undefined ? '' : ` in ${env}`}`,
    {
      hint: CAPABILITY_INFO[capability].desc,
      nextSteps: [workspaceCommand(deps, 'manifest', 'providers')],
    },
  );
}

function toolUndeclared(
  deps: WorkspaceDeps,
  capability: Capability,
  served: { readonly provider: string; readonly name: string },
): DevkitError {
  return new DevkitError(
    'config',
    'TOOL_UNDECLARED',
    `${served.name} is not declared in the toolchain`,
    {
      hint: `The provider bound to ${capability} is ${served.provider}; fx checks a companion tool only where a tools document declares it.`,
      nextSteps: [
        `Declare ${served.name} in the manifest tools document.`,
        workspaceCommand(deps, 'manifest', 'schema', '--kind', 'tools'),
        workspaceCommand(deps, 'tool', 'list'),
      ],
    },
  );
}

// An environment-scoped capability lives on a platform instance; which
// one is the environment's business, so it needs --env.
function bindingFor(
  deps: WorkspaceDeps,
  capability: Capability,
  env: string | undefined,
): Binding | PlatformBinding | null {
  if (CAPABILITY_INFO[capability].scope !== 'environment')
    return deps.ctx.bindings.find((b) => b.capability === capability) ?? null;
  if (env === undefined) {
    throw new DevkitError(
      'usage',
      'ENV_REQUIRED',
      `${capability} depends on the environment; pass --env`,
      {
        hint: 'Environments are listed by `fx env list`.',
        nextSteps: [
          workspaceCommand(deps, 'env', 'list'),
          workspaceCommand(deps, 'can', capability, '--env', '<env>'),
        ],
      },
    );
  }
  return selectBinding(
    deps,
    deps.ctx.platforms.filter((b) => b.capability === capability),
    env,
    capability,
  );
}

function bindingDriving(
  deps: WorkspaceDeps,
  login: LoginDeps,
  tool: string,
  env: string | undefined,
): Binding | PlatformBinding | null {
  const drives = (b: Binding | PlatformBinding): boolean =>
    b.provider !== null && (login.describeProvider(b.provider)?.tools ?? []).includes(tool);
  return selectBinding(
    deps,
    [...deps.ctx.bindings, ...deps.ctx.platforms].filter(drives),
    env,
    tool,
  );
}

function selectBinding(
  deps: WorkspaceDeps,
  candidates: readonly (Binding | PlatformBinding)[],
  env: string | undefined,
  name: string,
): Binding | PlatformBinding | null {
  let scoped = candidates;
  if (env !== undefined && candidates.some((binding) => 'platform' in binding)) {
    const environments = environmentsOf(deps.ctx, deps.commandShell);
    const spec = environments.envs[env];
    if (spec === undefined) throw envNotFound(deps, env, Object.keys(environments.envs));
    const covered = candidates.filter(
      (b) => !('platform' in b) || spec.platforms?.[b.platform] !== undefined,
    );
    // Retain a single uncovered binding so coverage remains a negative verdict.
    if (covered.length > 0) scoped = covered;
  }
  if (scoped.length > 1) {
    const names = scoped.map((b) => ('platform' in b ? b.platform : b.capability)).sort();
    throw new DevkitError(
      'usage',
      'CAN_AMBIGUOUS',
      `${name} matches multiple bindings: ${names.join(', ')}`,
      {
        hint: 'Choose a capability and environment with one binding; use where --platform to inspect a specific platform.',
        nextSteps: [
          workspaceCommand(deps, 'manifest', 'providers'),
          workspaceCommand(deps, 'env', 'list'),
          'fx where --help',
        ],
      },
    );
  }
  return scoped[0] ?? null;
}
