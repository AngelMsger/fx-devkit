// The stores a supervisor needs only when its run failed, wired apart from the
// entry so that a run which answers normally never loads them.

import { SystemClock } from '../adapters/clock/system-clock.js';
import { recordRunFailure } from '../application/hook/supervisor-report.js';
import { parseHookRequest } from '../domain/harness/request.js';
import { FileHookState } from '../infra/hook-state.js';
import { FileLock } from '../infra/lock.js';

export async function reportBackgroundFailure(
  argv: readonly string[],
  reason: string,
): Promise<void> {
  const request = parseHookRequest(argv);
  if (!request) return;
  await recordRunFailure(
    {
      clock: new SystemClock(),
      state: new FileHookState(request.home),
      lock: new FileLock(request.home),
    },
    { workspace: request.workspace, root: request.root, reason },
  );
}
