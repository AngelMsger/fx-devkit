// Start an executable that findExecutable resolved. A batch file runs under cmd.exe,
// which parses the command line once and again wherever the batch expands %*, as the
// shims npm, Scoop and Chocolatey install do. cross-spawn escapes for that second parse
// only under node_modules/.bin, so fx starts every batch file itself, with each
// argument escaped for both parses, and leaves everything else to cross-spawn.

import { spawn as spawnNode, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';

import spawn from 'cross-spawn';

const BATCH = /\.(?:bat|cmd)$/i;
// cross-spawn's escaping (lib/util/escape.js), from https://qntm.org/cmd.
const META = /([()\][%!^"`<>&|;, *?])/g;

export function launch(
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  if (process.platform !== 'win32' || !BATCH.test(executable))
    return spawn(executable, [...args], options);
  const line = [escapeMeta(path.normalize(executable)), ...args.map(batchArgument)].join(' ');
  return spawnNode(process.env['comspec'] ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

function batchArgument(arg: string): string {
  return escapeMeta(escapeMeta(quoted(arg)));
}

// The program's own reading of its command line: backslashes are literal except in
// a run before a quote, so such a run is doubled, before an inner quote and before
// the closing one.
function quoted(arg: string): string {
  let text = '"';
  let slashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      slashes += 1;
      continue;
    }
    text += '\\'.repeat(char === '"' ? slashes * 2 + 1 : slashes) + char;
    slashes = 0;
  }
  return text + '\\'.repeat(slashes * 2) + '"';
}

function escapeMeta(text: string): string {
  return text.replace(META, '^$1');
}
