// Personal journals may create missing directories, but must not traverse a
// foreign ancestor. The owning store supplies its public corruption error.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { isAtOrInside, samePath } from '../domain/path.js';

export async function assertStoreParents(
  home: string,
  file: string,
  invalid: () => Error,
): Promise<void> {
  const root = path.resolve(home);
  const target = path.resolve(file);
  if (samePath(target, root) || !isAtOrInside(target, root)) throw invalid();
  for (let directory = path.dirname(target); ; directory = path.dirname(directory)) {
    try {
      if (!(await fs.lstat(directory)).isDirectory()) throw invalid();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw invalid();
    }
    if (samePath(directory, root)) return;
  }
}
