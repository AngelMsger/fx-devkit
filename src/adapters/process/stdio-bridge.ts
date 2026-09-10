// Host-owned MCP processes need byte streams, not the CLI's buffered results
// or notices. The projected vector has already passed workspace trust.

import spawn from 'cross-spawn';

import { findExecutable, mergeEnvironment } from './executable.js';
import { terminateChild } from './terminate.js';

export async function runStdioBridge(vector: readonly string[]): Promise<void> {
  const [binary, ...args] = vector;
  if (!binary) {
    process.exitCode = 2;
    return;
  }
  const env = mergeEnvironment(process.env);
  const executable = await findExecutable(binary, { env });
  if (!executable) {
    process.exitCode = 127;
    return;
  }
  const child = spawn(executable, args, { env, stdio: 'inherit', windowsHide: true });
  const stop = (): void => terminateChild(child);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
  await new Promise<void>((resolve) => {
    child.once('error', () => {
      process.exitCode = 1;
      resolve();
    });
    child.once('close', (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
}
