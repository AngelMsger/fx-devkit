// Just enough semver for version floors: parse, compare, and tell a release
// from a development build. A prerelease or 0.0.0 is a development build.

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
}

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(text: string): Semver | undefined {
  const m = PATTERN.exec(text.trim());
  if (m === null) return undefined;
  const base = { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
  return m[4] === undefined ? base : { ...base, prerelease: m[4] };
}

export function isSemver(text: string): boolean {
  return parseSemver(text) !== undefined;
}

export function compareSemver(a: Semver, b: Semver): number {
  for (const part of ['major', 'minor', 'patch'] as const) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

export function isRelease(text: string): boolean {
  const v = parseSemver(text);
  return v !== undefined && v.prerelease === undefined && (v.major | v.minor | v.patch) !== 0;
}

export function atLeast(version: string, floor: string): boolean {
  const v = parseSemver(version);
  const f = parseSemver(floor);
  if (v === undefined || f === undefined) return false;
  return compareSemver(v, f) >= 0;
}
