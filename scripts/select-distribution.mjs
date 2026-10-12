// @ts-check
// Select metadata in a disposable CI checkout. Never insert registry or credential data.
import { readFileSync, writeFileSync } from 'node:fs';

import { distribution } from '../src/domain/distribution.js';
const selected = distribution(process.argv[2]);
if (process.argv.length !== 3)
  throw new Error('Usage: node scripts/select-distribution.mjs internal|public');
const file = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(file, 'utf8'));
if (pkg.bin?.fx !== 'bin/fx.js') throw new Error('Unexpected fx binary configuration.');
pkg.name = selected.packageName;
pkg.publishConfig = { access: selected.access };
for (const key of ['homepage', 'repository', 'bugs']) delete pkg[key];
if (process.argv[2] === 'public') {
  pkg.homepage = 'https://angelmsger.github.io/fx-devkit/';
  pkg.repository = { type: 'git', url: 'git+https://github.com/AngelMsger/fx-devkit.git' };
  pkg.bugs = { url: 'https://github.com/AngelMsger/fx-devkit/issues' };
}
writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
const lockfile = new URL('../package-lock.json', import.meta.url);
const lock = JSON.parse(readFileSync(lockfile, 'utf8'));
lock.name = selected.packageName;
lock.packages[''].name = selected.packageName;
writeFileSync(lockfile, JSON.stringify(lock, null, 2) + '\n');
console.log(`Selected ${process.argv[2]} package: ${selected.packageName}`);
