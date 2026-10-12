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
  // Backslashes before a quote, or before the closing quote added below, are doubled.
  // The lookahead keeps both patterns linear on long runs of backslashes.
  const quoted = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1');
  return escapeMeta(escapeMeta(`"${quoted}"`));
}

function escapeMeta(text: string): string {
  return text.replace(META, '^$1');
}
