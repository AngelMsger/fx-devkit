// Global agent unpick cleans only that agent's receipts in registered roots.
// A missing or inaccessible workspace remains a row so cleanup can be retried.

import { asDevkitError } from '../../domain/errors.js';
import { parseBoolean, parseList } from '../../domain/values.js';
import type { AgentCleanupRow } from '../../ports/agent-cleanup.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ConfigStore } from '../../ports/stores.js';
import { resolveKey } from '../config/resolve.js';
import type { WritePosture } from '../safety/posture.js';

import { ReconcileHooks, type HookDeps } from './reconcile.js';

export class CleanupAgentHooks {
  constructor(
    private readonly deps: HookDeps,
    private readonly config: ConfigStore,
    private readonly fs: FileSystem,
  ) {}

  async execute(input: {
    readonly ids: readonly string[];
    readonly dryRun: boolean;
    readonly posture: WritePosture;
    readonly env: NodeJS.ProcessEnv;
  }): Promise<readonly AgentCleanupRow[]> {
    const file = await this.config.read();
    const rows: AgentCleanupRow[] = [];
    for (const [workspace, entry] of Object.entries(file.workspaces ?? {})) {
      try {
        const root = await this.fs.realpath(entry.root);
        if (!(await this.fs.isDirectory(root))) {
          rows.push(...input.ids.map((agent) => ({ workspace, agent, action: 'root_missing' })));
          continue;
        }
        const result = await new ReconcileHooks(this.deps).execute({
          workspace,
          root,
          action: 'sync',
          removeAgents: input.ids,
          dryRun: input.dryRun,
          posture: input.posture,
          configured: parseList(resolveKey('agents', { env: input.env, file }).value),
          globalEnabled:
            parseBoolean(resolveKey('hooks', { env: input.env, file }).value) !== false,
        });
        rows.push(
          ...result.items
            .filter((row) => input.ids.includes(row.agent))
            .map((row) => ({ workspace, agent: row.agent, action: row.action })),
        );
      } catch (err) {
        rows.push(
          ...input.ids.map((agent) => ({ workspace, agent, action: asDevkitError(err).code })),
        );
      }
    }
    return rows;
  }
}
