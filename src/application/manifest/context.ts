// A manifest loaded from a directory, with the bindings it implies: what
// every manifest command and the region renderer work on. A workspace wraps
// one; a checkout of the manifest repository is one on its own.

import {
  bindPlatforms,
  bindProviders,
  type Binding,
  type PlatformBinding,
  type ProviderCatalog,
} from '../../domain/manifest/providers.js';
import type { DiagnosticReporter } from '../../ports/diagnostics.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Reporter } from '../../ports/reporter.js';

import { LoadManifest, type ManifestBundle } from './load.js';

export interface ManifestContext {
  readonly dir: string;
  readonly bundle: ManifestBundle;
  // The catalog the bindings were read against: a later pass over the same manifest
  // reads it the same way instead of finding its own.
  readonly providers: ProviderCatalog;
  readonly bindings: readonly Binding[];
  readonly platforms: readonly PlatformBinding[];
}

export interface ManifestLoadInput {
  readonly dir: string;
  readonly fs: FileSystem;
  readonly bundledTools: () => string;
  readonly providers: ProviderCatalog;
  readonly cliVersion: string;
  readonly reporter: Reporter;
  readonly diagnostics?: DiagnosticReporter | undefined;
}

export async function loadManifestContext(input: ManifestLoadInput): Promise<ManifestContext> {
  const bundle = await new LoadManifest(input.fs, input.bundledTools, input.diagnostics).execute({
    dir: input.dir,
    cliVersion: input.cliVersion,
    providers: input.providers,
  });
  const dropped = [
    ...bundle.workspace.result.dropped,
    ...(bundle.harness?.result.dropped ?? []),
  ].map((d) => d.name);
  if (dropped.length > 0) {
    input.reporter.notice({
      code: 'MANIFEST_ENTRY_UNUSABLE',
      message: `${dropped.length} manifest entr${dropped.length === 1 ? 'y' : 'ies'} could not be used by this fx and were skipped: ${dropped.join(', ')}`,
      nextSteps: ['fx manifest validate', 'fx --version'],
      data: { dropped },
    });
  }
  return {
    dir: input.dir,
    bundle,
    providers: input.providers,
    bindings: bindProviders(bundle.workspace.result.doc, input.providers),
    platforms: bindPlatforms(bundle.environments?.result.doc, input.providers),
  };
}
