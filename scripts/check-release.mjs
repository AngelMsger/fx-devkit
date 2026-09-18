// @ts-check
// Refuse a mismatched release tag before binding publication credentials.
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.TAG_NAME;
if (tag ? tag !== `v${version}` : process.env.BRANCH_NAME !== 'main') {
  console.error('Publication requires main or a tag matching the package version exactly.');
  process.exit(1);
}
console.log(`Release version: ${version}`);
