// A tool's version is whatever semver appears first in its `--version`
// output; the family's four output shapes and git's all reduce to that.

const SEMVER = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;

export function extractSemver(text: string): string | undefined {
  return SEMVER.exec(text)?.[0];
}
