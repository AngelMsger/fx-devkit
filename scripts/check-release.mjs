// @ts-check
// Refuse a mismatched release tag before binding publication credentials.
import { readFileSync } from 'node:fs';

import { compareSemver, parseSemver } from '../src/domain/semver.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.TAG_NAME;
const tagged = tag === undefined || tag === '' ? undefined : parseSemver(tag);
const packaged = parseSemver(version);
const matches =
  tagged !== undefined && packaged !== undefined && compareSemver(tagged, packaged) === 0;
if (tag ? !matches : process.env.BRANCH_NAME !== 'main') {
  console.error('Publication requires main or a tag matching the package version exactly.');
  process.exit(1);
}
console.log(`Release version: ${version}`);
