// @ts-check
// The package file list owns scan coverage. Unknown/glob paths fail closed in
// the scanner instead of silently leaving newly distributed content unchecked.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const implicit = ['package.json', 'README.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt'].filter(
  (file) => existsSync(new URL(`../${file}`, import.meta.url)),
);
const paths = [...new Set([...pkg.files, ...implicit])];
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('./check-distributable.mjs', import.meta.url)), ...paths],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
