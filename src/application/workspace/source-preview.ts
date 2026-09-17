// Validate readable source contents without cloning or mutating personal state.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ManifestSource } from '../../ports/manifest-source.js';
import { LoadManifest } from '../manifest/load.js';

interface InspectableSource extends ManifestSource {
  inspect?(): Promise<
    { readonly root: string; readText(relative: string): Promise<string | undefined> } | undefined
  >;
}
export async function inspectRebindSource(
  source: InspectableSource,
  input: {
    readonly fs: FileSystem;
    readonly bundledTools: () => string;
    readonly cliVersion: string;
  },
): Promise<'validated' | 'pending_apply'> {
  let inspection = await source.inspect?.();
  if (!inspection && source.kind === 'file') {
    const root = source.description;
    const nested = await input.fs.exists(path.join(root, 'manifest/workspace.yaml'));
    if (!nested && !(await input.fs.exists(path.join(root, 'workspace.yaml'))))
      throw new DevkitError(
        'not_found',
        'MANIFEST_SOURCE_INVALID',
        'The local source contains no workspace.yaml.',
        { nextSteps: ['fx workspace rebind --help'] },
      );
    inspection = {
      root,
      readText: (relative) =>
        input.fs.readText(path.join(root, nested ? relative : relative.replace(/^manifest\//, ''))),
    };
  }
  if (!inspection) return 'pending_apply';
  const reader = inspection;
  await new LoadManifest(
    { readText: (file) => reader.readText(path.relative(reader.root, file)) },
    input.bundledTools,
  ).execute({ dir: reader.root, cliVersion: input.cliVersion });
  return 'validated';
}
