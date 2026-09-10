// Shared JavaScript keeps the same registry policy available to runtime adapters
// and pre-build publication guards. Coordinates come only from caller configuration.

/** @param {unknown} value @returns {string | null} */
export function privateRegistry(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/\.+$/, '');
    const publicHosts = ['npmjs.org', 'npmjs.com', 'yarnpkg.com'];
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      publicHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** @param {{packageName: string, registry: string}} input @returns {string[]} */
export function registryArguments({ packageName, registry }) {
  const scope = /^(@[^/]+)\//.exec(packageName)?.[1];
  return ['--registry', registry, ...(scope ? [`--${scope}:registry=${registry}`] : [])];
}
