// @ts-check
// Shared JavaScript keeps the same registry policy available to runtime adapters
// and pre-build publication guards. Private coordinates come only from configuration.
import { PUBLIC_REGISTRY, packageChannel } from '../../domain/distribution.js';
import { isPublicHttpUrl } from '../../domain/public-url.js';

/** @param {unknown} value @returns {string | null} */
function registryUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return isPublicHttpUrl(text) ? new URL(text).href : null;
}

/** @param {unknown} value @returns {string | null} */
export function privateRegistry(value) {
  const registry = registryUrl(value);
  if (!registry) return null;
  const host = new URL(registry).hostname.toLowerCase().replace(/\.+$/, '');
  const publicHosts = ['npmjs.org', 'npmjs.com', 'yarnpkg.com'];
  return publicHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))
    ? null
    : registry;
}

/** @param {{packageName: string, registry: string, packageOnly?: boolean}} input @returns {string[]} */
export function registryArguments({ packageName, registry, packageOnly = false }) {
  const scope = /^(@[^/]+)\//.exec(packageName)?.[1];
  return [
    ...(packageOnly && scope ? [] : ['--registry', registry]),
    ...(scope ? [`--${scope}:registry=${registry}`] : []),
  ];
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
  return registryUrl(configured);
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
