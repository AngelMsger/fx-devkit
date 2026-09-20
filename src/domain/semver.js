// @ts-check
// Just enough semver for version floors: parse, compare, and tell a release
// from a development build. A prerelease or 0.0.0 is a development build.
// JavaScript, because the release gate runs it before there is a build.

/**
 * @typedef {{ major: number, minor: number, patch: number, prerelease?: string }} Semver
 */

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * @param {string} text
 * @returns {Semver | undefined}
 */
export function parseSemver(text) {
  const m = PATTERN.exec(text.trim());
  if (m === null) return undefined;
  const base = { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
  return m[4] === undefined ? base : { ...base, prerelease: m[4] };
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isSemver(text) {
  return parseSemver(text) !== undefined;
}

/**
 * @param {Semver} a
 * @param {Semver} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  for (const part of /** @type {const} */ (['major', 'minor', 'patch'])) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isRelease(text) {
  const v = parseSemver(text);
  return v !== undefined && v.prerelease === undefined && (v.major | v.minor | v.patch) !== 0;
}

/**
 * @param {string} version
 * @param {string} floor
 * @returns {boolean}
 */
export function atLeast(version, floor) {
  const v = parseSemver(version);
  const f = parseSemver(floor);
  if (v === undefined || f === undefined) return false;
  return compareSemver(v, f) >= 0;
}
