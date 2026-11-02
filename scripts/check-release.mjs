// @ts-check
// Refuse a mismatched release tag before binding publication credentials.
// A release tag is literally `v<package.json version>`, the family-wide rule:
// one tag per version, so `0.1.0` or `v0.1.0+build.7` never publish 0.1.0.
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.TAG_NAME;
if (tag ? tag !== `v${version}` : process.env.BRANCH_NAME !== 'main') {
  console.error('Publication requires main or a tag that is exactly v<package.json version>.');
  process.exit(1);
}
console.log(`Release version: ${version}`);
