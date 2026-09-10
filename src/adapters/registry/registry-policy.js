// Shared JavaScript keeps the same registry policy available to runtime adapters
// and pre-build publication guards. Private coordinates come only from configuration.
import { PUBLIC_REGISTRY, packageChannel } from '../../domain/distribution.js';

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

/** @param {string} packageName @param {unknown} configured */
export function publicationRegistry(packageName, configured) {
  if (packageChannel(packageName) === 'internal') return privateRegistry(configured);
  // Public artifacts must never be redirected to a private destination by ambient config.
  return configured === undefined || isPublicRegistry(configured) ? PUBLIC_REGISTRY : null;
}
/** @param {string} packageName @param {unknown} configured */
export function runtimeRegistry(packageName, configured) {
  if (packageChannel(packageName) === 'internal') return privateRegistry(configured);
  if (configured === undefined || isPublicRegistry(configured)) return PUBLIC_REGISTRY;
  return privateRegistry(configured);
}

/** @param {unknown} value */
function isPublicRegistry(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value.trim()).href === PUBLIC_REGISTRY;
  } catch {
    return false;
  }
}
