// Every binding in one table: the workspace-scoped capabilities and the
// platform instances, each with where its provider came from.

import {
  bindPlatforms,
  bindProviders,
  type Binding,
  type ProviderCatalog,
} from '../../domain/manifest/providers.js';
import type { FileSystem } from '../../ports/fs.js';

import { LoadManifest } from './load.js';

export interface ProvidersManifestInput {
  readonly dir: string;
  readonly cliVersion: string;
  readonly providers: ProviderCatalog;
}

export interface BindingRow extends Binding {
  readonly scope: 'workspace' | 'environment';
  readonly platform: string | null;
}

export const BINDING_COLUMNS = [
  'scope',
  'capability',
  'platform',
  'provider',
  'source',
  'vars',
] as const;

export class ProvidersManifest {
  constructor(
    private readonly fs: FileSystem,
    private readonly bundledTools: () => string,
  ) {}

  async execute(input: ProvidersManifestInput): Promise<BindingRow[]> {
    const bundle = await new LoadManifest(this.fs, this.bundledTools).execute(input);
    return [
      ...bindProviders(bundle.workspace.result.doc, input.providers).map((b) => ({
        scope: 'workspace' as const,
        platform: null,
        ...b,
      })),
      ...bindPlatforms(bundle.environments?.result.doc, input.providers).map(
        ({ platform, ...b }) => ({
          scope: 'environment' as const,
          platform,
          ...b,
        }),
      ),
    ];
  }
}
