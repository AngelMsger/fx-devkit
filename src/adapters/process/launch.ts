// Start an executable that findExecutable resolved. A batch file runs under cmd.exe,
// which reads the command line first. The batch then reads each argument itself
// (`%~1`) or hands them all on (`%*`, as the shims npm, Scoop and Chocolatey install
// do), and cmd reads them again on that line. Caret escaping, as cross-spawn applies
// it, suits only one of those readers, so fx starts every batch file itself, with each
// argument inside quotes where cmd leaves metacharacters alone, and leaves everything
// else to cross-spawn. The encoding follows Rust's standard library (CVE-2024-24576).

import { spawn as spawnNode, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';

import spawn from 'cross-spawn';

const BATCH = /\.(?:bat|cmd)$/i;

export function launch(
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  if (process.platform !== 'win32' || !BATCH.test(executable))
    return spawn(executable, [...args], options);
  const line = [path.normalize(executable), ...args].map(batchArgument).join(' ');
  // /v:off keeps !name! literal whatever delayed expansion the registry turns on.
  return spawnNode(process.env['comspec'] ?? 'cmd.exe', ['/d', '/v:off', '/s', '/c', `"${line}"`], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

// One quoted argument that cmd, the batch and the program it starts all read whole.
// A quote inside is doubled, so cmd never sees one unbalanced and the program's parser
// reads the pair back as one; backslashes are doubled only in a run before a quote.
// Each percent sign is followed by an empty expansion, so no %name% survives to expand.
function batchArgument(arg: string): string {
  let text = '"';
  let slashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      slashes += 1;
      continue;
    }
    if (char === '"') text += '\\'.repeat(slashes * 2) + '""';
    else text += '\\'.repeat(slashes) + (char === '%' ? '%%cd:~,%' : char);
    slashes = 0;
  }
  return text + '\\'.repeat(slashes * 2) + '"';
}
