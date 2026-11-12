// Pinned declaration and history evidence, independent of release policy. A field
// change is a first-parent Git event, never a publication or deployment timestamp.

import type { ErrorEnvelope } from '../errors.js';
import type { Commit } from '../workspace/commits.js';

export interface VersionSource {
  readonly file: string;
  readonly field: string;
  readonly package_name: string | null;
}

export interface VersionDeclaration extends VersionSource {
  readonly value: string;
}

export type EvidenceFailure = ErrorEnvelope['error'];

export interface VersionChange {
  readonly commit_sha: string;
  readonly committed_at: string | null;
  readonly previous_value: string | null;
  readonly current_value: string;
  readonly history_mode: 'first_parent';
  readonly kind: 'changed' | 'root_declaration';
}

export interface VersionEvidence {
  readonly requested_ref: string;
  readonly resolved_sha: string | null;
  readonly declaration: VersionDeclaration | null;
  readonly last_change: VersionChange | null;
  readonly coverage: 'checked' | 'incomplete';
  readonly commits_read: number;
  readonly termination: 'changed' | 'root_declaration' | 'limit' | 'boundary' | 'query_failed';
  readonly next_sha: string | null;
  readonly failures: readonly EvidenceFailure[];
}

export interface VersionSnapshot {
  readonly requested_ref: string;
  readonly resolved_sha: string | null;
  readonly declaration: VersionDeclaration | null;
}

export interface BaselineEvidence {
  readonly baseline: VersionSnapshot;
  readonly head: VersionSnapshot;
  // All commits reachable from head but not baseline, without author/bot filtering.
  readonly commits: readonly Commit[] | null;
  readonly coverage: 'checked' | 'incomplete';
  readonly failures: readonly EvidenceFailure[];
}

export function sameVersionSource(a: VersionSource, b: VersionSource): boolean {
  return a.file === b.file && a.field === b.field && a.package_name === b.package_name;
}
