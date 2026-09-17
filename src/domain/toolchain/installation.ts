// Immutable checkpoints distinguish attempted execution, package success and probe outcomes.

export interface ToolInstallation {
  readonly id: string;
  readonly at: string;
  readonly event: 'started' | 'installed' | 'finished';
  readonly operation: 'init' | 'install' | 'update';
  readonly workspace: string | null;
  readonly name: string;
  readonly binary: string;
  readonly via: 'npm' | 'brew' | 'go';
  readonly spec: string;
  readonly vector: readonly string[];
  readonly code: number | null;
  readonly version_after: string | null;
  readonly binary_path: string | null;
  readonly failure_code: string | null;
}
