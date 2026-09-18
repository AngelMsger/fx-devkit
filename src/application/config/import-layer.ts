// Validate incoming personal layers against available shared declarations before persisting them.

import path from 'node:path';

import { loadWorkspace } from '../../domain/manifest/loader.js';
import type { ProviderCatalog } from '../../domain/manifest/providers.js';
import { describeManifestRepo } from '../../domain/manifest/source-repo.js';
import type { LocalLayer } from '../../domain/manifest/types.js';
import type { FileReader } from '../../ports/fs.js';
import type { WorkspaceEntry } from '../../ports/stores.js';
import { contextualWorkspaceError } from '../workspace/health.js';
import { validateWorkspaceLayer } from '../workspace/validate-layer.js';

export async function validateImportedLayer(input: {
  readonly fs: FileReader;
  readonly name: string;
  readonly entry: WorkspaceEntry;
  readonly manifestDir: string;
  readonly cliVersion: string;
  readonly providers: ProviderCatalog;
  readonly layer: LocalLayer;
}): Promise<void> {
  const text = await input.fs.readText(path.join(input.manifestDir, 'manifest/workspace.yaml'));
  if (text === undefined) return;
  try {
    const shared = loadWorkspace(text, {
      cliVersion: input.cliVersion,
      providers: input.providers,
    }).doc;
    const manifestRepo =
      input.entry.source !== undefined &&
      (await input.fs.exists(path.join(input.manifestDir, '.git')))
        ? describeManifestRepo(input.entry.source, input.manifestDir, 'main')
        : undefined;
    await validateWorkspaceLayer(input.fs, input.entry.root, shared, input.layer, manifestRepo);
  } catch (error) {
    throw contextualWorkspaceError(
      {},
      {
        name: input.name,
        root: input.entry.root,
        manifestDir: input.manifestDir,
        selection: 'explicit',
      },
      error,
    );
  }
}
