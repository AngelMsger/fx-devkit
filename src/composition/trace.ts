// Where the invocation trace is appended, when FX_TRACE names a file.

import { appendLineTo } from '../infra/trace-file.js';

export function traceSinkFor(
  env: NodeJS.ProcessEnv,
): ((line: string) => Promise<void>) | undefined {
  const file = env['FX_TRACE'];
  return file === undefined || file === '' ? undefined : appendLineTo(file);
}
