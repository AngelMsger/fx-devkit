// Global agent unpick cleans only that agent's receipts in registered roots.
// A missing or inaccessible workspace remains a row so cleanup can be retried.

import type { AgentCleanupRow } from '../../ports/agent-cleanup.js';
import type { AgentCleanupInput } from '../agent/cleanup.js';
import { cleanupAgentWorkspaces, type RegisteredWorkspaces } from '../agent/workspace-cleanup.js';
import { readSettings } from '../config/settings.js';

import { ReconcileHooks } from './reconcile.js';
import type { HookDeps } from './types.js';

export class CleanupAgentHooks {
  constructor(
    private readonly deps: HookDeps,
    private readonly registered: RegisteredWorkspaces,
  ) {}

  async execute(input: AgentCleanupInput): Promise<readonly AgentCleanupRow[]> {
    const file = await this.registered.config.read();
    const settings = readSettings({ env: input.env, file });
    return cleanupAgentWorkspaces(
      { ...this.registered, lock: this.deps.lock },
      {
        ...input,
        workspaces: Object.keys(file.workspaces ?? {}),
        reconcile: async (workspace, root) => {
          const result = await new ReconcileHooks(this.deps).execute({
            workspace,
            root,
            action: 'sync',
            removeAgents: input.ids,
            dryRun: input.dryRun,
            posture: input.posture,
            configured: settings.agents,
            globalEnabled: settings.hooks,
          });
          return result.items
            .filter((row) => input.ids.includes(row.agent))
            .map((row) => ({ workspace, agent: row.agent, action: row.action }));
        },
      },
    );
  }
}
