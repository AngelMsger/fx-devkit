// The built-in providers, and how a manifest binding becomes a live port. `register`
// exists so a test or a later plugin loader can add one; the table itself is static.

import { ExtensionHookProtocol } from '../adapters/agent-host/extension-hooks.js';
import { SpecAgentHost, type AgentHostDeps } from '../adapters/agent-host/host.js';
import { JsonHookProtocol } from '../adapters/agent-host/json-hooks.js';
import { JsonMcpCodec } from '../adapters/agent-host/json-mcp.js';
import { AGENT_SPECS, type AgentHostSpec } from '../adapters/agent-host/specs.js';
import { TomlMcpCodec } from '../adapters/agent-host/toml-mcp.js';
import { larkCalendarProvider } from '../adapters/calendar/lark-calendar/provider.js';
import { wecomCalendarProvider } from '../adapters/calendar/wecom-calendar/provider.js';
import { wecomCalendarCliProvider } from '../adapters/calendar/wecom-calendar-cli/provider.js';
import { githubActionsProvider } from '../adapters/ci/github-actions/provider.js';
import { jenkinsCliProvider } from '../adapters/ci/jenkins-cli/provider.js';
import { kubectlProvider } from '../adapters/cluster/kubectl/provider.js';
import { bitbucketCliProvider } from '../adapters/code-host/bitbucket-cli/provider.js';
import { githubProvider } from '../adapters/code-host/github/provider.js';
import { localGitProvider } from '../adapters/code-host/local-git/provider.js';
import { sentryProvider } from '../adapters/error-tracker/sentry/provider.js';
import { larkProvider } from '../adapters/im/lark/provider.js';
import { wecomProvider } from '../adapters/im/wecom/provider.js';
import { feishuProjectProvider } from '../adapters/issue-tracker/feishu-project/provider.js';
import { jiraCliProvider } from '../adapters/issue-tracker/jira-cli/provider.js';
import { confluenceProvider } from '../adapters/knowledge-base/confluence/provider.js';
import { larkWikiProvider } from '../adapters/knowledge-base/lark-wiki/provider.js';
import { openobserveCliProvider } from '../adapters/log-store/openobserve-cli/provider.js';
import { tencentMeetingProvider } from '../adapters/meeting/tencent-meeting/provider.js';
import { prometheusCliProvider } from '../adapters/metrics/prometheus-cli/provider.js';
import { larkTaskProvider } from '../adapters/task/lark-task/provider.js';
import { wecomTodoProvider } from '../adapters/task/wecom-todo/provider.js';
import { jiraWorklogProvider } from '../adapters/worklog/jira-worklog/provider.js';
import type { CapabilityName } from '../domain/capability.js';
import { hookProtocolUnsupported, type HookSupport } from '../domain/harness/hooks.js';
import { projectRulesPointer } from '../domain/harness/rules.js';
import {
  platformOf,
  requireProvider,
  type Binding,
  type PlatformBinding,
  type ProviderCatalog,
} from '../domain/manifest/providers.js';
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
  if (create === undefined) throw hookProtocolUnsupported();
  return create();
}

export function createAgentHosts(
  deps: AgentHostDeps,
  specs: readonly AgentHostSpec[] = AGENT_SPECS,
): AgentHost[] {
  return specs.map((spec) => new SpecAgentHost(spec, deps));
}

export function register<P>(descriptor: ProviderDescriptor<P>): void {
  providers.set(descriptor.id, descriptor);
}

export function providersFor(capability: CapabilityName): ProviderDescriptor<unknown>[] {
  return [...providers.values()].filter((p) => p.capability === capability);
}

export function describeProvider(id: string): ProviderDescriptor<unknown> | undefined {
  return providers.get(id);
}

// What a manifest is read against: the same descriptors, narrowed to the facts the
// documents are validated and bound with.
export function providerCatalog(): ProviderCatalog {
  return [...providers.values()];
}

export function resolveProvider<P>(binding: Binding | PlatformBinding, deps: AdapterDeps): P {
  const descriptor = requireProvider(binding, [...providers.values()]);
  const { capability } = binding;
  const scoped = processWithContext(deps.process, {
    phase: 'provider query',
    capability,
    provider: descriptor.id,
    binding: platformOf(binding) ?? capability,
  });
  return descriptor.create({ ...deps, process: scoped }, binding.vars) as P;
}

// Registration is a load-time effect: importing this module is what makes the
// built-in providers exist, and insertion order is listing order, so the lines
// below decide how `fx manifest providers` and every "Available:" hint read.
register(bitbucketCliProvider);
register(githubProvider);
register(localGitProvider);
register(sentryProvider);
register(openobserveCliProvider);
register(prometheusCliProvider);
register(jenkinsCliProvider);
register(githubActionsProvider);
register(kubectlProvider);
register(feishuProjectProvider);
register(jiraCliProvider);
register(confluenceProvider);
register(larkWikiProvider);
register(larkProvider);
register(wecomProvider);
register(larkCalendarProvider);
register(wecomCalendarProvider);
register(wecomCalendarCliProvider);
register(tencentMeetingProvider);
register(larkTaskProvider);
register(wecomTodoProvider);
register(jiraWorklogProvider);
