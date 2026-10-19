// @ts-check
// What a shared coordinate may be: an absolute HTTP(S) URL that carries no
// credentials, query or fragment. JavaScript, because the registry policy that
// publication guards load before a build applies it too.

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
