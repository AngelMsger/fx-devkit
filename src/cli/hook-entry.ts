// Lifecycle stdout belongs to the host protocol. This entry bypasses the
// ordinary command renderer, update notices and trace finalization.

import { runHookEntry } from '../composition/hook-entry.js';
import { asDevkitError } from '../domain/errors.js';

export async function hookMain(argv: readonly string[], background = false): Promise<void> {
  try {
    const output = await runHookEntry(
      argv,
      background ? Promise.resolve('{}') : readInput(),
      background,
      reportHookFailure,
    );
    if (output) process.stdout.write(output);
  } catch (error) {
    const failure = asDevkitError(error);
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
  process.stdin.destroy();
  process.exitCode = 0;
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
