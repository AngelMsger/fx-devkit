// Worker wiring is loaded only below the independent supervisor. Its process
// port is bounded; the automatic services expose no repository sync stage.

import { DeadlineProcess } from '../adapters/process/deadline-process.js';
import { NodeHookTasks } from '../adapters/process/hook-tasks.js';
import { acceptBackground, DispatchHook } from '../application/hook/dispatch.js';
import { COMPANION_COMMAND_MS, WORKER_BUDGET_MS } from '../domain/harness/deadlines.js';
import { parseHookRequest } from '../domain/harness/request.js';

import { createContainer } from './container.js';
import { hookDeps } from './hooks.js';
import { hookHandlers, lifecycleHandlers } from './lifecycle-handlers.js';

export async function runHookWorker(
  args: readonly string[],
  raw: string,
  background: boolean,
): Promise<string> {
  const request = parseHookRequest(args);
  if (!request) return '';
  const env: NodeJS.ProcessEnv = { ...process.env, FX_HOME: request.home };
  const container = createContainer(env, {
    decorateProcess: (process) =>
      new DeadlineProcess(process, { totalMs: WORKER_BUDGET_MS, commandMs: COMPANION_COMMAND_MS }),
  });
  const hooks = hookDeps(container);
  const dispatchDeps = {
    handlers: hookHandlers(),
    ...hooks,
    config: container.config,
    fs: container.fs,
    clock: container.clock,
    tasks: new NodeHookTasks(hooks.executable),
  };
  if (!background) return new DispatchHook(dispatchDeps).execute({ request, raw, env });
  const canWrite = (): Promise<boolean> => acceptBackground({ deps: dispatchDeps, request, env });
  // Asked before the handler builds its wiring from the request: an unbound request,
  // whose workspace name may not even be a usable one, ends silently.
  if (!(await canWrite())) return '';
  await lifecycleHandlers[request.event]?.background({ container, request, env, canWrite });
  return '';
}
