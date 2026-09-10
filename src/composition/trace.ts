// The invocation trace, when FX_TRACE names a file.

import { Trace } from '../cli/trace.js';
import { appendLineTo } from '../infra/trace-file.js';

export function traceFor(env: NodeJS.ProcessEnv, now: number): Trace | undefined {
  const file = env['FX_TRACE'];
  return file === undefined || file === '' ? undefined : new Trace(appendLineTo(file), now);
}
