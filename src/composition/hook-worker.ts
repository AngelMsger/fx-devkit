// Worker wiring is loaded only below the independent supervisor. Its process
// port is bounded; the automatic services expose no repository sync stage.

import { DeadlineProcess } from '../adapters/process/deadline-process.js';
import { NodeHookTasks } from '../adapters/process/hook-tasks.js';
import { acceptHook, DispatchHook } from '../application/hook/dispatch.js';
import { resolvePosture } from '../application/safety/posture.js';
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
  const dispatch = new DispatchHook(dispatchDeps);
  if (!background) return dispatch.execute({ request, raw, env });
  const payload = JSON.stringify({ cwd: request.root });
  const canWrite = async (): Promise<boolean> =>
    (await acceptHook({ deps: dispatchDeps, request, raw: payload, env })) &&
    !resolvePosture({ allowWrites: false, env, file: await container.config.read() }).readOnly;
  if (!(await canWrite())) return '';
  await lifecycleHandlers[request.event]?.background({ container, request, env, canWrite });
  return '';
}
