// The lifecycle entry wires only the supervisor. Workspace loading and all
// filesystem work happen inside its separately bounded child process, except
// for recording how a background run ended.

import { fileURLToPath } from 'node:url';

import { NodeLifecycleRunner } from '../adapters/process/lifecycle-runner.js';

export async function recordBackgroundFailure(
  argv: readonly string[],
  reason: string,
): Promise<void> {
  const { reportBackgroundFailure } = await import('./hook-report.js');
  await reportBackgroundFailure(argv, reason);
}

export async function runHookEntry(
  argv: readonly string[],
  input: Promise<string>,
  background: boolean,
  failed?: (code: string) => void,
): Promise<string> {
  return new NodeLifecycleRunner(failed).run({
    vector: [
      process.execPath,
      fileURLToPath(new URL('../cli/hook-worker.js', import.meta.url)),
      background ? 'background' : 'foreground',
      ...argv,
    ],
    input,
    timeoutMs: background ? 30000 : 2000,
    role: background ? 'background' : 'foreground',
  });
}
