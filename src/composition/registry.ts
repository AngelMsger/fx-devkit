// The built-in providers, and how a manifest binding becomes a live port. `register`
// exists so a test or a later plugin loader can add one; the table itself is static.

import { ExtensionHookProtocol } from '../adapters/agent-host/extension-hooks.js';
import { SpecAgentHost, type AgentHostDeps } from '../adapters/agent-host/host.js';
import { JsonHookProtocol } from '../adapters/agent-host/json-hooks.js';
import { JsonMcpCodec } from '../adapters/agent-host/json-mcp.js';
import { AGENT_SPECS, type AgentHostSpec } from '../adapters/agent-host/specs.js';
import { TomlMcpCodec } from '../adapters/agent-host/toml-mcp.js';
import { jenkinsCliProvider } from '../adapters/ci/jenkins-cli/provider.js';
import { kubectlProvider } from '../adapters/cluster/kubectl/provider.js';
import { bitbucketCliProvider } from '../adapters/code-host/bitbucket-cli/provider.js';
import { localGitProvider } from '../adapters/code-host/local-git/provider.js';
import { sentryProvider } from '../adapters/error-tracker/sentry/provider.js';
import { larkProvider } from '../adapters/im/lark/provider.js';
import { wecomProvider } from '../adapters/im/wecom/provider.js';
import { feishuProjectProvider } from '../adapters/issue-tracker/feishu-project/provider.js';
import { confluenceProvider } from '../adapters/knowledge-base/confluence/provider.js';
import { openobserveCliProvider } from '../adapters/log-store/openobserve-cli/provider.js';
import type { Capability } from '../domain/capability.js';
import { DevkitError } from '../domain/errors.js';
import { nearest } from '../domain/fuzzy.js';
import type { HookSupport } from '../domain/harness/hooks.js';
import { projectRulesPointer } from '../domain/harness/rules.js';
import type { Binding, PlatformBinding } from '../domain/manifest/providers.js';
import type { AgentHost } from '../ports/agent-host.js';
import type { HookProtocol } from '../ports/hook-protocol.js';
import type { McpCodec } from '../ports/mcp-codec.js';
import type { AdapterDeps, ProviderDescriptor } from '../ports/provider.js';

import { processWithContext } from './diagnostics.js';

const providers = new Map<string, ProviderDescriptor<unknown>>();

const hookProtocols: Readonly<Record<string, () => HookProtocol>> = {
  'command-json': () => new JsonHookProtocol(),
  extension: () => new ExtensionHookProtocol(),
};

const mcpCodecs: Readonly<Record<string, () => McpCodec>> = {
  json: () => new JsonMcpCodec(),
  jsonc: () => new JsonMcpCodec(),
  toml: () => new TomlMcpCodec(),
};

const rulesProjectors: Readonly<Record<string, typeof projectRulesPointer>> = {
  markdown: projectRulesPointer,
};

export function rulesProjectorFor(protocol: string): typeof projectRulesPointer | undefined {
  return rulesProjectors[protocol];
}

export function mcpCodecFor(protocol: string): McpCodec | undefined {
  return mcpCodecs[protocol]?.();
}

export function hookProtocolFor(support: HookSupport, platform = process.platform): HookProtocol {
  if (support.protocol === 'command-json' && platform === 'win32')
    return new JsonHookProtocol(support.windowsCommand);
  const create = hookProtocols[support.protocol];
  if (create === undefined)
    throw new DevkitError(
      'config',
      'HOOK_PROTOCOL_UNSUPPORTED',
      'The lifecycle protocol is not available',
      {
        hint: 'This fx version does not implement the registered protocol.',
        nextSteps: ['fx self update'],
      },
    );
  return create();
}

export function createAgentHosts(
  deps: AgentHostDeps,
  specs: readonly AgentHostSpec[] = AGENT_SPECS,
): AgentHost[] {
  return specs.map((spec) => new SpecAgentHost(spec, deps));
}

export function register(descriptor: ProviderDescriptor<unknown>): void {
  providers.set(descriptor.id, descriptor);
}

export function providersFor(capability: Capability): ProviderDescriptor<unknown>[] {
  return [...providers.values()].filter((p) => p.capability === capability);
}

export function describeProvider(id: string): ProviderDescriptor<unknown> | undefined {
  return providers.get(id);
}

export function resolveProvider<P>(binding: Binding | PlatformBinding, deps: AdapterDeps): P {
  const capability = binding.capability;
  if (binding.provider === null) {
    throw new DevkitError('config', 'PROVIDER_UNBOUND', `No provider is bound for ${capability}`, {
      hint: `Add \`providers.${capability}\` to manifest/workspace.yaml. Available: ${ids(capability)}.`,
      nextSteps: ['fx manifest providers', `fx manifest explain providers`],
    });
  }
  const descriptor = providers.get(binding.provider);
  if (descriptor === undefined || descriptor.capability !== capability) {
    const suggestion = nearest(
      binding.provider,
      providersFor(capability as Capability).map((p) => p.id),
    );
    throw new DevkitError(
      'config',
      'PROVIDER_UNKNOWN',
      `"${binding.provider}" is not a ${capability} provider this fx knows`,
      {
        hint:
          suggestion === undefined
            ? `Available: ${ids(capability)}.`
            : `Did you mean "${suggestion}"?`,
        nextSteps: ['fx manifest providers', 'fx --version'],
      },
    );
  }
  const missing = descriptor.vars.filter((v) => v.required && !binding.vars[v.name]?.trim());
  if (missing.length > 0) {
    throw new DevkitError(
      'config',
      'PROVIDER_VAR_MISSING',
      `providers.${capability} (${descriptor.id}) is missing ${missing.map((v) => v.name).join(', ')}`,
      {
        hint: missing.map((v) => `${v.name}: ${v.desc}`).join('; '),
        nextSteps: [`fx manifest explain providers`],
      },
    );
  }
  const scoped = processWithContext(deps.process, {
    phase: 'provider query',
    capability,
    provider: descriptor.id,
    binding: 'platform' in binding ? binding.platform : capability,
  });
  return descriptor.create({ ...deps, process: scoped }, binding.vars) as P;
}

function ids(capability: string): string {
  return (
    providersFor(capability as Capability)
      .map((p) => p.id)
      .join(', ') || '(none)'
  );
}

register(bitbucketCliProvider as ProviderDescriptor<unknown>);
register(localGitProvider as ProviderDescriptor<unknown>);
register(sentryProvider as ProviderDescriptor<unknown>);
register(openobserveCliProvider as ProviderDescriptor<unknown>);
register(jenkinsCliProvider as ProviderDescriptor<unknown>);
register(kubectlProvider as ProviderDescriptor<unknown>);
register(feishuProjectProvider as ProviderDescriptor<unknown>);
register(confluenceProvider as ProviderDescriptor<unknown>);
register(larkProvider as ProviderDescriptor<unknown>);

register(wecomProvider as ProviderDescriptor<unknown>);
