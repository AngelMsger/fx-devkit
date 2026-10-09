// Removes unpicked agents from ownership records while preserving shared resources.

import type { AgentCleanupRow } from '../../ports/agent-cleanup.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ConfigStore } from '../../ports/stores.js';
import type { AgentCleanupInput } from '../agent/cleanup.js';
import { enabledHosts } from '../agent/list.js';
import { cleanupAgentWorkspaces } from '../agent/workspace-cleanup.js';
import { readSettings } from '../config/settings.js';

import { ReconcileHarness } from './reconcile.js';
import type { HarnessDeps } from './types.js';

export class CleanupAgentHarness {
  constructor(
    private readonly deps: HarnessDeps,
    private readonly config: ConfigStore,
    private readonly fs: FileSystem,
    private readonly manifestDirFor: (name: string) => string,
  ) {}
  async execute(input: AgentCleanupInput): Promise<readonly AgentCleanupRow[]> {
    const config = await this.config.read();
    const selected = await this.selected(input, config);
    return cleanupAgentWorkspaces(
      {
        config: this.config,
        fs: this.fs,
        lock: this.deps.lock,
        manifestDirFor: this.manifestDirFor,
      },
      {
        ...input,
        workspaces: Object.keys(config.workspaces ?? {}),
        kind: 'harness',
        reconcile: async (workspace, root) => {
          const result = await new ReconcileHarness(this.deps).execute({
            workspace,
            root,
            harness: undefined,
            selected,
            action: 'sync',
            dryRun: input.dryRun,
            yes: false,
            posture: input.posture,
            cleanupAgents: input.ids,
          });
          return result.items.flatMap((row) =>
            input.ids.map((agent) => ({ workspace, agent, kind: row.kind, action: row.action })),
          );
        },
      },
    );
  }
  private async selected(
    input: AgentCleanupInput,
    config: Awaited<ReturnType<ConfigStore['read']>>,
  ) {
    return (
      await enabledHosts(this.deps.hosts, readSettings({ env: input.env, file: config }).agents)
    )
      .map((host) => host.id)
      .filter((id) => !input.ids.includes(id));
  }
}
