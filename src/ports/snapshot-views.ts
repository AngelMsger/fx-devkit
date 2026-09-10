// A candidate view exposes only captured bytes. It cannot fall through to a
// checkout or provide write methods to manifest inspection.

import type { FileReader } from './fs.js';

export interface SnapshotView {
  readonly root: string;
  readonly reader: FileReader;
}

export interface SnapshotViews {
  open(files: Readonly<Record<string, string>>): SnapshotView;
}
