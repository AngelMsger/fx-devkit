// Only the registered session-start background task can be launched. A
// manifest command can never become a supervisor task or bypass its trust gate.

import type { HookRequest } from '../domain/harness/request.js';

export interface HookTasks {
  start(request: HookRequest): Promise<void>;
}
