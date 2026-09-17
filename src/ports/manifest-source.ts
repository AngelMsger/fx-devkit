// Where a workspace's manifest comes from: a git repository, a directory whose files are
// copied, or text on stdin. It is materialized into the workspace's source directory
// under ~/.fx, never into the root. Only a repository source can refresh itself later.

export interface RefreshOutcome {
  // `kept`: the working tree was left as it is; `reason` says why.
  readonly result: 'updated' | 'up_to_date' | 'kept';
  readonly reason?: string;
}

export interface ManifestSourceInspection {
  readonly root: string;
  readonly contents?: 'commit' | 'worktree';
  readText(relativePath: string): Promise<string | undefined>;
}

export interface ManifestSource {
  readonly kind: 'repo' | 'file' | 'stdin';
  // Recorded in ~/.fx/config.yaml so the source can be rebuilt later.
  readonly description: string;
  inspect?(currentDir?: string): Promise<ManifestSourceInspection | undefined>;
  materialize(dir: string): Promise<void>;
  refresh?(dir: string): Promise<RefreshOutcome>;
}
