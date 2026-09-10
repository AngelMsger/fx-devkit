// The configured package registry, asked one thing: the newest
// released version of a package. Any failure is thrown; the caller decides
// how quiet to be about it.

export interface Registry {
  latest(packageName: string, signal?: AbortSignal): Promise<string>;
}
