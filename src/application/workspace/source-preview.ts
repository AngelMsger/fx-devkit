// Inspect and validate rebind candidates while keeping recovery attached to their source.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import type { ProviderCatalog } from '../../domain/manifest/providers.js';
import type { ResolvedShell } from '../../domain/shell.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ManifestSource, ManifestSourceInspection } from '../../ports/manifest-source.js';
import { LoadManifest } from '../manifest/load.js';
import { sourceValidationError } from '../manifest/source-error.js';

interface RebindSourceInput {
  readonly fs: FileSystem;
  readonly bundledTools: () => string;
  readonly providers: ProviderCatalog;
  readonly cliVersion: string;
  readonly workspace: string;
  readonly commandShell?: ResolvedShell | undefined;
}

export async function inspectRebindSource(
  source: ManifestSource,
  input: RebindSourceInput,
): Promise<'validated' | 'pending_apply'> {
  let inspection: ManifestSourceInspection | undefined;
  try {
    inspection = await source.inspect?.();
    if (!inspection && source.kind === 'file') {
      const root = source.description;
      const nested = await input.fs.exists(path.join(root, 'manifest/workspace.yaml'));
      if (!nested && !(await input.fs.exists(path.join(root, 'workspace.yaml'))))
        throw new DevkitError(
          'not_found',
          'MANIFEST_SOURCE_INVALID',
          'The local source contains no workspace.yaml',
          { nextSteps: ['fx workspace rebind --help'] },
        );
      inspection = {
        root,
        readText: (relative) =>
          input.fs.readText(
            path.join(root, nested ? relative : relative.replace(/^manifest\//, '')),
          ),
      };
    }
    if (!inspection) return 'pending_apply';
    const reader = inspection;
    await new LoadManifest(
      {
        readText: (file) =>
          reader.readText(path.relative(reader.root, file).split(path.sep).join('/')),
      },
      input.bundledTools,
    ).execute({ dir: reader.root, cliVersion: input.cliVersion, providers: input.providers });
    return 'validated';
  } catch (error) {
    throw rebindSourceError(error, source, input, inspection);
  }
}

export async function materializeRebindSource(
  source: ManifestSource,
  input: RebindSourceInput,
  dir: string,
): Promise<void> {
  let materialized = false;
  try {
    await source.materialize(dir);
    materialized = true;
    await new LoadManifest(input.fs, input.bundledTools).execute({
      dir,
      cliVersion: input.cliVersion,
      providers: input.providers,
    });
  } catch (error) {
    throw rebindSourceError(error, source, input, materialized ? { root: dir } : undefined);
  }
}

function rebindSourceError(
  error: unknown,
  source: ManifestSource,
  input: RebindSourceInput,
  inspection: Pick<ManifestSourceInspection, 'root' | 'contents'> | undefined,
): DevkitError {
  return sourceValidationError(error, {
    source,
    inspected: inspection,
    retry: [
      'fx',
      'workspace',
      'rebind',
      input.workspace,
      '--from',
      source.description,
      '--dry-run',
    ],
    commandShell: input.commandShell,
    preservedWorkspace: input.workspace,
  });
}
