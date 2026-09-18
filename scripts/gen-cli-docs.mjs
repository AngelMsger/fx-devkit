// @ts-check
// Generates docs/cli/README.md from the built command registry so the
// reference can never drift from the code; `--check` fails when the committed
// file differs from what the registry would produce now.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderCliReference } from './cli-reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'docs', 'cli', 'README.md');
const check = process.argv.includes('--check');

const { COMMANDS, COMMAND_ALIASES, EVERYDAY } = await import(
  path.join(root, 'dist', 'cli', 'commands', 'index.js')
);
const { globalFlags } = await import(path.join(root, 'dist', 'cli', 'flags.js'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const output = renderCliReference({
  bin: pkg.oclif?.bin ?? 'fx',
  version: pkg.version,
  topics: pkg.oclif?.topics ?? {},
  commands: COMMANDS,
  aliases: COMMAND_ALIASES,
  everyday: EVERYDAY,
  globalFlags,
});

if (check) {
  let current;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = '';
  }
  if (current !== output) {
    console.error(`${path.relative(root, target)} is out of date; run npm run docs:gen`);
    process.exit(1);
  }
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, output);
  console.error(`wrote ${path.relative(root, target)}`);
}
