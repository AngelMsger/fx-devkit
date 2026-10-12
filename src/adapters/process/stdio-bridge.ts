// Host-owned MCP processes need byte streams, not the CLI's buffered results
// or notices. The projected vector has already passed workspace trust. The
// bridge reports the status it observed; landing it on the process is the
// entry point's job.

import { findExecutable, mergeEnvironment } from './executable.js';
import { launch } from './launch.js';
import { terminateChild } from './terminate.js';

// A shell reports a command it could not find as 127, and MCP hosts read that
// status the same way.
const COMMAND_NOT_FOUND = 127;

export async function runStdioBridge(vector: readonly string[]): Promise<{ exitCode: number }> {
  const [binary, ...args] = vector;
  if (!binary) return { exitCode: 2 };
  const env = mergeEnvironment(process.env);
  const executable = await findExecutable(binary, { env });
  if (!executable) return { exitCode: COMMAND_NOT_FOUND };
  const child = launch(executable, args, { env, stdio: 'inherit', windowsHide: true });
  const stop = (): void => terminateChild(child);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
  const exitCode = await new Promise<number>((resolve) => {
    child.once('error', () => resolve(1));
    child.once('close', (code) => resolve(code ?? 1));
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  return { exitCode };
}
