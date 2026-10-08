// @ts-check
// Checks built artefacts through the same boundary scanner as contributions,
// loaded from source. Build first; a missing target cannot count as a passing check.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { scanBoundary } from '../src/domain/boundary/scan.js';

const TEXT = /\.(?:js|mjs|cjs|ts|json|map|yaml|yml|md|txt)$/;
const SKIP = new Set(['node_modules', '.git']);

/** @param {string} file */
function problems(file) {
  const text = readFileSync(file, 'utf8');
  return scanBoundary({
    text,
    policy: 'distributable',
    syntax: /\.[cm]?[jt]s$/.test(file) ? 'code' : 'text',
  }).map((finding) => `${finding.rule} at ${finding.line}:${finding.column}`);
}

/**
 * @param {string} target
 * @returns {Generator<string>}
 */
function* files(target) {
  if (statSync(target).isDirectory()) {
    if (SKIP.has(path.basename(target))) return;
    for (const entry of readdirSync(target)) yield* files(path.join(target, entry));
    return;
  }
  if (TEXT.test(target)) yield target;
}

/** @param {string} target */
function exists(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('check-distributable: no targets given; nothing was checked');
  process.exit(1);
}
const missing = targets.filter((t) => !exists(t));
if (missing.length > 0) {
  console.error(`check-distributable: ${missing.join(', ')} does not exist; nothing was checked`);
  process.exit(1);
}

let count = 0;
for (const target of targets) {
  for (const file of files(target)) {
    for (const reason of problems(file)) {
      console.error(`${file}: ${reason}`);
      count += 1;
    }
  }
}
if (count > 0) {
  console.error(`check-distributable: ${count} problem(s)`);
  process.exit(1);
}
