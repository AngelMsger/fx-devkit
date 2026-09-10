// Only the supervisor starts this worker. Errors are deliberately silent at
// this boundary; automatic services persist bounded status codes themselves.

import { runHookWorker } from '../composition/hook-worker.js';

try {
  process.stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of process.stdin) raw += String(chunk);
  const output = await runHookWorker(process.argv.slice(3), raw, process.argv[2] === 'background');
  if (output) process.stdout.write(output);
} catch {
  /* The supervisor must receive no partial error payload. */
}
process.disconnect?.();
