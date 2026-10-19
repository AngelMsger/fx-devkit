// Assembles the harness ports a command needs into the session the application
// workflows take; selection, projection and MCP query policy stay there.

import type { HarnessSession } from '../application/harness/session.js';
import type { HarnessDeps } from '../application/harness/types.js';
import type { WritePosture } from '../application/safety/posture.js';
import type { ResolveInput } from '../application/workspace/resolve.js';
import type { ResolvedShell } from '../domain/shell.js';
import { FileHarnessState } from '../infra/harness-state.js';

import { trustGate, type Container } from './container.js';
import { mcpCodecFor, rulesProjectorFor } from './registry.js';

export interface HarnessCommandInput {
  readonly container: Container;
  readonly resolve: ResolveInput;
  readonly env: NodeJS.ProcessEnv;
  readonly cliVersion: string;
  readonly noInput: boolean;
  readonly yes: boolean;
  readonly posture: WritePosture;
  readonly commandShell?: ResolvedShell;
}

export function harnessDeps(command: HarnessCommandInput): HarnessDeps {
  const { container } = command;
  return {
    hosts: container.agents,
    state: new FileHarnessState(container.fxHome, container.lock),
    files: container.projections,
    lock: container.lock,
    trust: trustGate(container, command.noInput),
    env: command.env,
    codec: mcpCodecFor,
    rules: rulesProjectorFor,
  };
}

export function harnessSession(command: HarnessCommandInput): HarnessSession {
  return {
    resolve: command.resolve,
    env: command.env,
    cliVersion: command.cliVersion,
    yes: command.yes,
    posture: command.posture,
    deps: harnessDeps(command),
    config: command.container.config,
    process: command.container.process,
  };
}
