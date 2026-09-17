// Explicit workspace selection wins. Otherwise use the checkout around cwd
// for source maintenance, falling back to the registered workspace's source.

import path from 'node:path';

import { MANIFEST_FILES } from '../../domain/manifest/files.js';
import type { FileSystem } from '../../ports/fs.js';
import { resolveWorkspace, type ResolveInput } from '../workspace/resolve.js';

export { MANIFEST_DIR, MANIFEST_FILES } from '../../domain/manifest/files.js';

export async function locateManifestDir(fs: FileSystem, cwd: string): Promise<string | undefined> {
  let dir = path.resolve(cwd);
  for (;;) {
    if (await fs.exists(path.join(dir, MANIFEST_FILES.workspace))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function resolveManifestDir(input: ResolveInput): Promise<string> {
  if (input.name !== undefined) return (await resolveWorkspace(input)).manifestDir;
  return (
    (await locateManifestDir(input.fs, input.cwd)) ?? (await resolveWorkspace(input)).manifestDir
  );
}
