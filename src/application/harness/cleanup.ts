// Removes unpicked agents from ownership records while preserving shared resources.

import { asDevkitError } from '../../domain/errors.js';
import { parseList } from '../../domain/values.js';
import type { AgentCleanupRow } from '../../ports/agent-cleanup.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ConfigStore } from '../../ports/stores.js';
import { enabledHosts } from '../agent/list.js';
import { resolveKey } from '../config/resolve.js';
import type { WritePosture } from '../safety/posture.js';

import { ReconcileHarness } from './reconcile.js';
import type { HarnessDeps } from './types.js';

export interface HarnessCleanupInput {
  readonly ids: readonly string[];
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly env: NodeJS.ProcessEnv;
}
export class CleanupAgentHarness {
  constructor(
    private readonly deps: HarnessDeps,
    private readonly config: ConfigStore,
    private readonly fs: FileSystem,
  ) {}
  async execute(input: HarnessCleanupInput): Promise<readonly AgentCleanupRow[]> {
    const config = await this.config.read();
    const selected = (
      await enabledHosts(
        this.deps.hosts,
        parseList(resolveKey('agents', { env: input.env, file: config }).value),
      )
    )
      .map((host) => host.id)
      .filter((id) => !input.ids.includes(id));
    const rows: AgentCleanupRow[] = [];
    for (const [workspace, entry] of Object.entries(config.workspaces ?? {})) {
      try {
        const root = await this.fs.realpath(entry.root);
        if (!(await this.fs.isDirectory(root))) {
          rows.push(
            ...input.ids.map((agent) => ({
              workspace,
              agent,
              action: 'root_missing',
              kind: 'harness',
            })),
          );
          continue;
        }
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
        rows.push(
          ...result.items.flatMap((row) =>
            input.ids.map((agent) => ({ workspace, agent, kind: row.kind, action: row.action })),
          ),
        );
      } catch (error) {
        rows.push(
          ...input.ids.map((agent) => ({
            workspace,
            agent,
            kind: 'harness',
            action: asDevkitError(error).code,
          })),
        );
      }
    }
    return rows;
  }
}
