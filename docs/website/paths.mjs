// All deployable URLs work under an origin root or a GitHub project subpath.
import path from 'node:path';
export function basePath(value = '/') {
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(value))
    throw new Error('SITE_BASE_PATH must be / or /repository/ (with a trailing slash).');
  if (value.split('/').some((part) => part === '.' || part === '..'))
    throw new Error('SITE_BASE_PATH cannot contain traversal segments.');
  return value;
}
export function relativeHref(from, to) {
  const [target, hash] = to.split('#');
  const relative = path.posix.relative(from || '.', target || '.') || '.';
  return `${relative.startsWith('.') ? relative : `./${relative}`}${target.endsWith('/') || !target ? '/' : ''}${hash ? `#${hash}` : ''}`;
}
export function localizedRoute(locale, route = '') {
  return locale === 'en' ? route : `${locale}/${route}`;
}

export function siteOrigin(value = '') {
  if (!value) return '';
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error('SITE_ORIGIN must be an HTTP(S) origin without a path or credentials.');
  return value;
}
