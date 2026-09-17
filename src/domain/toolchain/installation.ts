// Immutable checkpoints distinguish execution, original installation ownership and probe outcomes.

export type InstallationOrigin = 'fx' | 'external' | 'unknown';

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
  // Absent in legacy checkpoints: a previous operation does not prove who installed the binary.
  readonly installation_origin?: InstallationOrigin | undefined;
  readonly binary_path_before?: string | null | undefined;
}
