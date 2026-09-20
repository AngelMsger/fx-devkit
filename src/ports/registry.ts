// The configured package registry, asked one thing: the newest
// released version of a package. Any failure is thrown; the caller decides
// how quiet to be about it.

export interface Registry {
  latest(packageName: string, signal?: AbortSignal): Promise<string>;
}

export interface RegistryLocation {
  readonly registry: string | null;
  readonly source:
    'environment' | 'npm_scope' | 'npm_default' | 'distribution_default' | 'unavailable';
}

export interface RegistryLocator {
  resolve(packageName: string): Promise<RegistryLocation>;
}
