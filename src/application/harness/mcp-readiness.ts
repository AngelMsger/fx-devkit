// Checks MCP prerequisites without starting servers or exposing command output.

import type { HandoffEnvelope } from '../../domain/errors.js';
import { assessMcpSupport, referencedVariables } from '../../domain/harness/mcp.js';
import type { McpResource } from '../../domain/manifest/types.js';
import { matchesJson } from '../../domain/setup/json-check.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { Process } from '../../ports/process.js';
import type { Verdict, ReadyStatus } from '../readiness/types.js';
import type { WritePosture } from '../safety/posture.js';
import type { TrustGate } from '../safety/trust.js';

import { mcpTrust, mcpCheckTrust } from './plan.js';
import { harnessHandoff } from './targets.js';

export interface McpReadinessDeps {
  readonly process: Process;
  readonly trust: TrustGate;
  readonly env: Readonly<Record<string, string | undefined>>;
}
export interface McpReadinessInput {
  readonly workspace: string;
  readonly resource: McpResource;
  readonly agent: AgentHost | null;
  readonly posture: WritePosture;
  readonly signal?: AbortSignal | undefined;
  readonly projection?:
    { readonly action: string; readonly handoff: HandoffEnvelope | null } | undefined;
}
export interface McpVerdict extends Verdict {
  readonly capability: 'mcp';
  readonly tool: string | null;
  readonly provider: null;
  readonly env: null;
  readonly resource: string;
  readonly agent: string | null;
  readonly evidence: 'prerequisites' | 'checked' | 'unverified';
  readonly activation: 'unverified';
  readonly projection: string | null;
}

export class McpReadiness {
  constructor(private readonly deps: McpReadinessDeps) {}
  async execute(input: McpReadinessInput): Promise<McpVerdict> {
    try {
      return await this.inspect(input);
    } catch {
      return verdict(
        input,
        'unknown',
        'MCP readiness could not be checked; retry the companion check.',
      );
    }
  }
  private async inspect(input: McpReadinessInput): Promise<McpVerdict> {
    if (input.signal?.aborted)
      return verdict(
        input,
        'unknown',
        'The readiness budget expired; retry this resource directly.',
      );
    const resource = input.resource;
    const host = inspectHost(input);
    if (host) return host;
    // Everything a person can fix without a process comes first, and both vectors are
    // approved before either is run: the declared check is the only step that executes.
    const binary = resource.command?.[0];
    if (binary && !(await this.deps.process.which(binary)))
      return verdict(input, 'missing_tool', `Install ${binary} or add it to PATH.`);
    const missing = referencedVariables(resource).filter((name) => !this.deps.env[name]);
    if (missing.length)
      return verdict(
        input,
        'unconfigured',
        missing
          .map(
            (name) =>
              `${name}: ${resource.variables?.[name]?.instructions ?? 'Obtain this environment variable.'}`,
          )
          .join('\n'),
      );
    const context = { workspace: input.workspace, posture: input.posture, yes: false };
    if (!(await this.deps.trust.isTrusted(mcpTrust(context, resource))))
      return verdict(
        input,
        'unconfigured',
        'Review the MCP configuration through fx sync --only mcp.',
      );
    if (!resource.check) {
      // Local prerequisites say nothing about whether a remote server answers.
      if (resource.transport === 'http')
        return verdict(
          input,
          'unknown',
          'Declare a read-only companion check before relying on remote readiness.',
        );
      return verdict(input, 'ready', null, 'prerequisites');
    }
    if (!(await this.deps.trust.isTrusted(mcpCheckTrust(context, resource))))
      return verdict(
        input,
        'unconfigured',
        'Review the companion check through fx sync --only mcp.',
      );
    if (!(await this.deps.process.which(resource.check.command[0]!)))
      return verdict(
        input,
        'missing_tool',
        `Install ${resource.check.command[0]} or add it to PATH.`,
      );
    return this.check(input);
  }
  private async check(input: McpReadinessInput): Promise<McpVerdict> {
    const resource = input.resource;
    const check = resource.check!;
    const result = await this.deps.process.run(check.command, {
      timeoutMs: 2000,
      sensitiveOutput: true,
      signal: input.signal,
      env: Object.fromEntries(
        Object.entries(resource.env ?? {}).map(([key, ref]) => [key, this.deps.env[ref.from_env]]),
      ),
      diagnostic: { phase: 'MCP readiness check' },
    });
    if (result.code === 0) {
      if (check.json && !matchesJson(result.stdout, check.json))
        return verdict(
          input,
          'unconfigured',
          'The companion response did not satisfy the declared readiness check.',
        );
      return verdict(input, 'ready', null, 'checked');
    }
    return verdict(
      input,
      result.code === 4 || result.code === 5 ? 'unconfigured' : 'unknown',
      'The companion check did not establish readiness; resolve access or connectivity and retry.',
    );
  }
}
function verdict(
  input: McpReadinessInput,
  status: ReadyStatus,
  message: string | null,
  evidence: McpVerdict['evidence'] = 'unverified',
): McpVerdict {
  return {
    status,
    handoff: message ? harnessHandoff(message) : null,
    alternatives: ['fx mcp show ' + input.resource.name, 'fx doctor'],
    capability: 'mcp',
    tool: input.resource.command?.[0] ?? null,
    provider: null,
    env: null,
    resource: input.resource.name,
    agent: input.agent?.id ?? null,
    evidence,
    activation: 'unverified',
    projection: input.projection?.action ?? null,
  };
}

function inspectHost(input: McpReadinessInput): McpVerdict | undefined {
  if (!input.agent) return undefined;
  const support = assessMcpSupport(input.agent.mcp, input.resource);
  if (!support.supported) return verdict(input, 'unconfigured', support.reason!);
  if (!input.projection || input.projection.action === 'unchanged') return undefined;
  const result = verdict(input, 'unconfigured', 'Run fx sync --only mcp to reconcile this host.');
  return { ...result, handoff: input.projection.handoff ?? result.handoff };
}
