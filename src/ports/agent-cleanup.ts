// Unpicking is global, so its hook cleanup spans registered workspaces. A
// preview names the same targets as application without changing the selection.

export interface AgentCleanupRow {
  readonly workspace: string;
  readonly kind?: string | undefined;
  readonly agent: string;
  readonly action: string;
}

export interface AgentCleanup {
  plan(ids: readonly string[]): Promise<readonly AgentCleanupRow[]>;
  apply(ids: readonly string[]): Promise<readonly AgentCleanupRow[]>;
}
