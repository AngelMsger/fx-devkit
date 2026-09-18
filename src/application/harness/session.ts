// Loads a validated harness snapshot and evaluates workspace MCP queries through ports.

import { DevkitError } from '../../domain/errors.js';
import { nearest } from '../../domain/fuzzy.js';
import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import { loadHarness } from '../../domain/manifest/loader.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { Process } from '../../ports/process.js';
import type { ConfigStore } from '../../ports/stores.js';
import { enabledHosts } from '../agent/list.js';
import { readSettings } from '../config/settings.js';
import type { WritePosture } from '../safety/posture.js';
import { resolveWorkspace, type ResolveInput } from '../workspace/resolve.js';

import { InspectMcp, type InspectMcpOutput } from './inspect.js';
import { McpReadiness, type McpVerdict } from './mcp-readiness.js';
import { findMcpResource } from './names.js';
import { ReconcileHarness } from './reconcile.js';
import type { HarnessDeps, HarnessInput } from './types.js';

export interface HarnessSession {
  readonly deps: HarnessDeps;
  readonly config: ConfigStore;
  readonly process: Process;
  readonly resolve: ResolveInput;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cliVersion: string;
  readonly yes: boolean;
  readonly posture: WritePosture;
}
export async function loadHarnessCommand(
  command: HarnessSession,
): Promise<{ deps: HarnessDeps; input: HarnessInput }> {
  const { deps } = command;
  const located = await resolveWorkspace(command.resolve);
  const files = deps.files;
  const source = { root: located.manifestDir, relative: MANIFEST_FILES.harness };
  const before = await files.read(source);
  if (before.kind === 'foreign')
    throw new DevkitError(
      'config',
      'HARNESS_SOURCE_FOREIGN',
      'The harness source is not a regular owned source file',
      { nextSteps: ['Inspect manifest/harness.yaml and its parent directories.'] },
    );
  const loaded =
    before.text === null ? undefined : loadHarness(before.text, { cliVersion: command.cliVersion });
  if (loaded?.dropped.length)
    command.resolve.reporter.notice({
      code: 'MANIFEST_ENTRY_UNUSABLE',
      message: 'Invalid harness resources were skipped.',
      nextSteps: ['fx manifest validate --kind harness'],
    });
  const config = await command.config.read();
  const selected = await enabledHosts(
    deps.hosts,
    readSettings({ env: command.env, file: config }).agents,
  );
  return {
    deps,
    input: {
      workspace: located.name,
      root: located.root,
      harness: loaded?.doc,
      selected: selected.map((host) => host.id),
      action: 'inspect',
      dryRun: true,
      yes: command.yes,
      posture: command.posture,
      source: { ...source, before },
    },
  };
}
export async function canMcp(
  command: HarnessSession & {
    readonly name: string;
    readonly agent?: string | undefined;
    readonly envName?: string | undefined;
  },
): Promise<McpVerdict> {
  if (command.envName !== undefined)
    throw new DevkitError(
      'usage',
      'MCP_ENV_UNSUPPORTED',
      'MCP resources are workspace-scoped; omit --env',
      { nextSteps: ['fx mcp list'] },
    );
  const { deps, input } = await loadHarnessCommand(command);
  const resource = findMcpResource(input.harness, command.name);
  const agent = command.agent === undefined ? null : findAgent(command.deps.hosts, command.agent);
  const projection = agent
    ? (
        await new ReconcileHarness(deps).execute({
          ...input,
          selected: [...new Set([...input.selected, agent.id])],
          only: 'mcp',
        })
      ).items.find(
        (row) =>
          row.agents.includes(agent.id) &&
          (row.name === resource.name || row.name === `fx-${resource.name}`),
      )
    : undefined;
  return new McpReadiness({
    process: command.process,
    trust: deps.trust,
    env: command.env,
  }).execute({ workspace: input.workspace, resource, agent, posture: command.posture, projection });
}
function findAgent(hosts: readonly AgentHost[], id: string): AgentHost {
  const host = hosts.find((item) => item.id === id);
  if (host) return host;
  const suggestion = nearest(
    id,
    hosts.map((item) => item.id),
  );
  throw new DevkitError('not_found', 'AGENT_UNKNOWN', 'The agent is not registered', {
    hint: suggestion ? `Did you mean "${suggestion}"?` : 'Use an agent ID from fx agent list.',
    nextSteps: ['fx agent list'],
  });
}

export async function inspectMcp(
  command: HarnessSession & { readonly name?: string | undefined },
): Promise<InspectMcpOutput> {
  const { deps, input } = await loadHarnessCommand(command);
  return new InspectMcp({ ...deps, process: command.process }).execute({
    ...input,
    name: command.name,
  });
}
