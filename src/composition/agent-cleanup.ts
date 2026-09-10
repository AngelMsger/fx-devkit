// Combines workspace resource cleanup behind the agent cleanup port.

import { CleanupAgentHarness } from '../application/harness/cleanup.js';
import type { AgentCleanup } from '../ports/agent-cleanup.js';

import { harnessDeps, type HarnessCommandInput } from './harness.js';
import { agentHookCleanup } from './hooks.js';

export function agentResourceCleanup(command: HarnessCommandInput): AgentCleanup {
  const hooks = agentHookCleanup(command.container, command.env, command.posture);
  const harness = new CleanupAgentHarness(
    harnessDeps(command),
    command.container.config,
    command.container.fs,
  );
  const run = async (ids: readonly string[], dryRun: boolean) => [
    ...(await (dryRun ? hooks.plan(ids) : hooks.apply(ids))),
    ...(await harness.execute({ ids, dryRun, posture: command.posture, env: command.env })),
  ];
  return { plan: (ids) => run(ids, true), apply: (ids) => run(ids, false) };
}
