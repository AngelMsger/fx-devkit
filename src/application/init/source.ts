// What a run reads its manifest from: a source to import, or the managed directory of
// a registered workspace, which a resumed run inspects as it stands.

import type { ManifestSource } from '../../ports/manifest-source.js';

export interface KeptSource {
  readonly kind: 'kept';
  // What the registration records as its source, if anything.
  readonly recorded: string | undefined;
  readonly inspect: NonNullable<ManifestSource['inspect']>;
}

export type InitSource = ManifestSource | KeptSource;

// A kept directory goes by what its registration records, and by `-` when that is
// nothing; its contents are read the way a directory source's are.
export function sourceIdentity(source: InitSource): Pick<ManifestSource, 'description' | 'kind'> {
  return source.kind === 'kept' ? { description: source.recorded ?? '-', kind: 'file' } : source;
}
