// Agent removal visits registered roots under the same lifecycle guards for
// every resource owner. One inaccessible workspace must not hide the others.

import { asDevkitError } from '../../domain/errors.js';
import type { AgentCleanupRow } from '../../ports/agent-cleanup.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Lock } from '../../ports/lock.js';
import type { ConfigStore } from '../../ports/stores.js';
import { assertNoWorkspaceOperation } from '../workspace/health.js';
import { withWorkspaceOperation } from '../workspace/operation.js';

import type { AgentCleanupInput } from './cleanup.js';

interface CleanupDeps {
  readonly config: ConfigStore;
  readonly fs: FileSystem;
  readonly lock: Lock;
  readonly manifestDirFor: (name: string) => string;
}

interface WorkspaceCleanupInput extends AgentCleanupInput {
  readonly workspaces: readonly string[];
  readonly kind?: string;
  readonly reconcile: (workspace: string, root: string) => Promise<readonly AgentCleanupRow[]>;
}

export async function cleanupAgentWorkspaces(
  deps: CleanupDeps,
  input: WorkspaceCleanupInput,
): Promise<readonly AgentCleanupRow[]> {
  const rows: AgentCleanupRow[] = [];
  for (const workspace of input.workspaces) {
    try {
      rows.push(
        ...(await withWorkspaceOperation(deps.lock, workspace, input.dryRun, () =>
          cleanupWorkspace(deps, input, workspace),
        )),
      );
    } catch (error) {
      rows.push(...failureRows(input, workspace, asDevkitError(error).code));
    }
  }
  return rows;
}

async function cleanupWorkspace(
  deps: CleanupDeps,
  input: WorkspaceCleanupInput,
  workspace: string,
): Promise<readonly AgentCleanupRow[]> {
  const entry = (await deps.config.read()).workspaces?.[workspace];
  if (!entry) return [];
  await assertNoWorkspaceOperation(
    { fs: deps.fs },
    { name: workspace, manifestDir: deps.manifestDirFor(workspace) },
  );
  const root = await deps.fs.realpath(entry.root);
  return (await deps.fs.isDirectory(root))
    ? input.reconcile(workspace, root)
    : failureRows(input, workspace, 'root_missing');
}

function failureRows(
  input: WorkspaceCleanupInput,
  workspace: string,
  action: string,
): AgentCleanupRow[] {
  return input.ids.map((agent) => ({
    workspace,
    agent,
    action,
    ...(input.kind === undefined ? {} : { kind: input.kind }),
  }));
}
