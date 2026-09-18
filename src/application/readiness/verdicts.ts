// The two verdicts that are mostly guidance: a tool whose version check did not
// answer, and a tool whose command has not been approved. Both say "unknown",
// and each names the one thing a person can do about it.

import { handoffEnvelope } from '../../domain/errors.js';
import { shellLine } from '../../domain/shell.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { LoginDeps } from '../login/deps.js';
import { commandTrustHandoff } from '../safety/trust.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand } from '../workspace/guidance.js';

import type { Verdict } from './types.js';

export function versionUnknown(deps: WorkspaceDeps, tool: ResolvedTool): Verdict {
  const command = workspaceCommand(deps, 'doctor', '--tool', tool.name);
  const inspect = workspaceCommand(deps, 'tool', 'show', tool.name);
  const probe = shellLine([tool.binary, ...tool.versionArgs], deps.commandShell);
  return {
    status: 'unknown',
    handoff: handoffEnvelope({
      summary: `${tool.name} could not pass its version check`,
      command,
      userSteps: [
        {
          id: `${tool.name}.version`,
          kind: 'manual',
          title: 'Diagnose the installed tool before changing authentication',
          instructions: `Inspect the executable on PATH and the result of ${probe}. Check startup errors, exit status and version output; this is not evidence of an authentication failure.`,
        },
      ],
    }),
    alternatives: [inspect, workspaceCommand(deps, 'doctor')],
  };
}

export function untrusted(deps: WorkspaceDeps, login: LoginDeps, tool: string): Verdict {
  const handoff = commandTrustHandoff({
    tool,
    posture: login.trust.posture,
    workspace: deps.ctx.name,
    commandShell: deps.commandShell,
  });
  return {
    status: 'unknown',
    handoff,
    alternatives: handoff.alternatives ?? [workspaceCommand(deps, 'doctor')],
  };
}
