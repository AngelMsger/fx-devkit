// Captured contribution entries describe working-file bytes independently of
// the real index. Adapters reject unreadable or non-text entries before capture.

export interface ContributionFile {
  readonly path: string;
  readonly kind: 'file' | 'deleted' | 'symlink' | 'gitlink';
  readonly mode: '100644' | '100755';
  readonly content: string | null;
  readonly renamePeer?: string;
}
