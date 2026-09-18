// Lifecycle stdout belongs to the host protocol. This entry bypasses the
// ordinary command renderer, update notices and trace finalization.

import { recordBackgroundFailure, runHookEntry } from '../composition/hook-entry.js';
import { asDevkitError } from '../domain/errors.js';

export async function hookMain(argv: readonly string[], background = false): Promise<void> {
  // How a background run ended is written only once it is over: until the
  // supervisor resolves, the worker it is reaping may still be writing there.
  let ended: string | undefined;
  const failed = background
    ? (reason: string): void => {
        ended = reason;
      }
    : reportHookFailure;
  try {
    const output = await runHookEntry(
      argv,
      background ? Promise.resolve('{}') : readInput(),
      background,
      failed,
    );
    if (output) process.stdout.write(output);
  } catch (error) {
    const failure = asDevkitError(error);
    if (background) ended ??= 'HOOK_FAILED_OPEN';
    // Never echo argv, stdin, paths or provider output into the host session.
    process.stderr.write(
      JSON.stringify({
        _notice: {
          code: 'HOOK_FAILED_OPEN',
          category: failure.category,
          nextSteps: ['fx hook list --format json', 'fx doctor --format json'],
        },
      }) + '\n',
    );
  }
  if (ended !== undefined) await recordEnd(argv, ended);
  process.stdin.destroy();
  process.exitCode = 0;
}

// A supervisor that cannot record how its run ended still fails open.
async function recordEnd(argv: readonly string[], reason: string): Promise<void> {
  try {
    await recordBackgroundFailure(argv, reason);
  } catch {
    return;
  }
}

function readInput(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
      if (Buffer.byteLength(text) > 65536) {
        process.stdin.destroy();
        resolve('');
      }
    });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  });
}

function reportHookFailure(reason: string): void {
  process.stderr.write(
    JSON.stringify({
      _notice: {
        code: 'HOOK_FAILED_OPEN',
        reason,
        nextSteps: ['fx hook list --format json', 'fx doctor --format json'],
      },
    }) + '\n',
  );
}
