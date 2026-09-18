// Managed files are observed before planning and rechecked at application.
// Foreign includes links and directories: a codec only receives regular text.

export interface ProjectionPath {
  readonly root: string;
  readonly relative: string;
}
export interface ProjectionSnapshot {
  readonly kind: 'absent' | 'file' | 'foreign';
  readonly text: string | null;
}
export interface ProjectionWrite extends ProjectionPath {
  readonly before: ProjectionSnapshot;
  readonly text: string | null;
}
export interface ProjectionStore {
  read(at: ProjectionPath): Promise<ProjectionSnapshot>;
  write(input: ProjectionWrite): Promise<'written' | 'unchanged' | 'conflict' | 'busy'>;
}

// Link projections share the bounded parent-path checks of managed text files.
export interface LinkProjectionSnapshot {
  readonly kind: 'absent' | 'link' | 'foreign' | 'unsafe';
  readonly target: string | null;
}
export interface LinkProjectionWrite extends ProjectionPath {
  readonly before: LinkProjectionSnapshot;
  readonly target: string | null;
}
export interface LinkProjectionStore {
  readLink(at: ProjectionPath): Promise<LinkProjectionSnapshot>;
  writeLink(input: LinkProjectionWrite): Promise<'written' | 'unchanged' | 'conflict' | 'busy'>;
}
