// Start an executable that findExecutable resolved. A batch file runs under cmd.exe,
// which reads the command line first. The batch then reads each argument itself
// (`%~1`, as mvn.cmd does) or hands them all on (`%*`, as the shims npm, Scoop and
// Chocolatey install do), and cmd reads that line again. Caret escaping throughout,
// as cross-spawn applies it, suits only one of those readers, so fx starts every batch
// file itself and leaves everything else to cross-spawn.

import { spawn as spawnNode, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';

import spawn from 'cross-spawn';

const BATCH = /\.(?:bat|cmd)$/i;
// What cmd acts on outside quotes.
const SPECIAL = /[&|<>^()!]/;

export function launch(
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  if (process.platform !== 'win32' || !BATCH.test(executable))
    return spawn(executable, [...args], options);
  // /v:off keeps !name! literal whatever delayed expansion the registry turns on.
  return spawnNode(
    process.env['comspec'] ?? 'cmd.exe',
    ['/d', '/v:off', '/s', '/c', `"${batchLine([path.normalize(executable), ...args])}"`],
    { ...options, windowsVerbatimArguments: true },
  );
}

// Every argument is quoted for the program at the end of the chain, and cmd leaves
// whatever sits inside quotes alone, so an argument without a quote of its own reaches
// `%~1` unchanged. A quote inside an argument turns cmd's quoting off until the next
// one; there, cmd's special characters are escaped for both of its reads. Each percent
// sign is followed by an empty expansion, so no %name% survives to expand.
function batchLine(vector: readonly string[]): string {
  let line = '';
  let quoted = false;
  for (const char of vector.map(programArgument).join(' ')) {
    if (char === '"') quoted = !quoted;
    if (char === '%') line += '%%cd:~,%';
    else if (!quoted && SPECIAL.test(char)) line += '^^^' + char;
    else line += char;
  }
  return line;
}

// The program's own reading of its command line: backslashes are literal except in
// a run before a quote, so such a run is doubled, before an inner quote and before
// the closing one.
function programArgument(arg: string): string {
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
