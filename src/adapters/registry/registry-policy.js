// @ts-check
// Shared JavaScript keeps the same registry policy available to runtime adapters
// and pre-build publication guards. Mirror coordinates come only from configuration.
import { PUBLIC_REGISTRY } from '../../domain/distribution.js';

/** @param {unknown} value @returns {string | null} */
function registryUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** A configured registry that is not a public npm host, such as a team mirror. @param {unknown} value @returns {string | null} */
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

/** Releases go to npmjs only; ambient config never redirects them. @param {unknown} configured */
export function publicationRegistry(configured) {
  return configured === undefined || isPublicRegistry(configured) ? PUBLIC_REGISTRY : null;
}
/** Updates default to npmjs and follow a valid configured mirror. @param {unknown} configured */
export function runtimeRegistry(configured) {
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
