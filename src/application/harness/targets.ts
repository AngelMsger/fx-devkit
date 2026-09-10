// Resolves shared resource targets for selected agents and cleanup.

import { createHash } from 'node:crypto';

import { handoffEnvelope, type HandoffEnvelope } from '../../domain/errors.js';
import { assessMcpSupport } from '../../domain/harness/mcp.js';
import type { HarnessState } from '../../domain/harness/ownership.js';
import type { AgentHost } from '../../ports/agent-host.js';

import type { HarnessDeps, HarnessInput, HarnessRow, HarnessTarget } from './types.js';

export function harnessTargets(
  deps: HarnessDeps,
  input: HarnessInput,
  state: HarnessState,
): { targets: HarnessTarget[]; rows: HarnessRow[] } {
  if (input.cleanupAgents) return cleanupTargets(deps, input, state);
  const targets = new Map<string, HarnessTarget>();
  const rows: HarnessRow[] = [];
  for (const host of deps.hosts.filter((host) => input.selected.includes(host.id))) {
    addHostMcp(deps, input, host, targets, rows);
    if (
      input.only !== 'mcp' &&
      input.harness &&
      input.harness.rules?.enabled !== false &&
      host.rules
    )
      addTarget(targets, {
        kind: 'rules',
        name: 'fx-rules',
        relative: host.rules.projectPath,
        protocol: host.rules.protocol,
        agents: [host.id],
        resource: null,
        support: null,
        remove: false,
      });
  }
  for (const receipt of state.receipts) {
    if (input.only && receipt.kind !== input.only) continue;
    if (
      !targets.has(receipt.key) &&
      !rows.some(
        (row) =>
          row.kind === receipt.kind &&
          row.agents.some((id) => receipt.agents.includes(id)) &&
          `fx-${row.name}` === receipt.name,
      )
    )
      targets.set(receipt.key, {
        ...receipt,
        resource: null,
        support:
          (deps.hosts
            .map((host) => host.mcp)
            .find(
              (support) =>
                support.status === 'supported' &&
                support.projectPath === receipt.relative &&
                support.protocol === receipt.protocol,
            ) as HarnessTarget['support']) ?? null,
        remove: true,
      });
  }
  return { targets: [...targets.values()], rows };
}
function addHostMcp(
  deps: HarnessDeps,
  input: HarnessInput,
  host: AgentHost,
  targets: Map<string, HarnessTarget>,
  rows: HarnessRow[],
): void {
  if (input.only !== 'rules')
    for (const resource of input.harness?.mcp ?? []) {
      const support = host.mcp;
      const compatibility = assessMcpSupport(support, resource);
      if (
        !compatibility.supported ||
        support.status !== 'supported' ||
        !deps.codec(support.protocol)
      ) {
        rows.push({
          key: `${host.id}:${resource.name}`,
          kind: 'mcp',
          name: resource.name,
          agents: [host.id],
          path: null,
          action: 'unsupported',
          variables: [],
          handoff: harnessHandoff(compatibility.reason ?? 'The native protocol is unavailable.'),
        });
        continue;
      }
      addTarget(targets, {
        kind: 'mcp',
        name: `fx-${resource.name}`,
        relative: support.projectPath,
        protocol: support.protocol,
        agents: [host.id],
        resource,
        support,
        remove: false,
      });
    }
}
function addTarget(targets: Map<string, HarnessTarget>, target: Omit<HarnessTarget, 'key'>): void {
  const key = createHash('sha256')
    .update(JSON.stringify([target.kind, target.relative, target.protocol, target.name]))
    .digest('hex');
  const existing = targets.get(key);
  targets.set(key, {
    ...target,
    key,
    agents: [...new Set([...(existing?.agents ?? []), ...target.agents])].sort(),
  });
}
export function harnessHandoff(message: string): HandoffEnvelope {
  return handoffEnvelope({
    summary: message,
    command: 'fx sync --only mcp,docs',
    userSteps: [{ id: 'harness-setup', kind: 'manual', title: message }],
    alternatives: ['fx doctor'],
  });
}

function cleanupTargets(
  deps: HarnessDeps,
  input: HarnessInput,
  state: HarnessState,
): { targets: HarnessTarget[]; rows: HarnessRow[] } {
  const targets: HarnessTarget[] = [];
  for (const receipt of state.receipts) {
    if (!receipt.agents.some((id) => input.cleanupAgents?.includes(id))) continue;
    const agents = receipt.agents.filter(
      (id) => !input.cleanupAgents?.includes(id) && input.selected.includes(id),
    );
    const support =
      deps.hosts
        .flatMap((host) => (host.mcp.status === 'supported' ? [host.mcp] : []))
        .find(
          (spec) => spec.projectPath === receipt.relative && spec.protocol === receipt.protocol,
        ) ?? null;
    targets.push({ ...receipt, agents, support, resource: null, remove: agents.length === 0 });
  }
  return { targets, rows: [] };
}
