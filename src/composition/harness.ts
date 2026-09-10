// Assembles harness ports; source selection and MCP query policy live in application.

import * as session from '../application/harness/session.js';
import type { HarnessDeps } from '../application/harness/types.js';
import type { WritePosture } from '../application/safety/posture.js';
import { TrustGate } from '../application/safety/trust.js';
import type { ResolveInput } from '../application/workspace/resolve.js';
import { FileHarnessState } from '../infra/harness-state.js';
import { FileProjectionStore } from '../infra/projection-store.js';

import type { Container } from './container.js';
import { mcpCodecFor, rulesProjectorFor } from './registry.js';

export interface HarnessCommandInput {
  readonly container: Container;
  readonly resolve: ResolveInput;
  readonly env: NodeJS.ProcessEnv;
  readonly cliVersion: string;
  readonly noInput: boolean;
  readonly yes: boolean;
  readonly posture: WritePosture;
}

export function harnessDeps(command: HarnessCommandInput): HarnessDeps {
  const { container } = command;
  return {
    hosts: container.agents,
    state: new FileHarnessState(container.fxHome, container.lock),
    files: new FileProjectionStore(container.lock),
    lock: container.lock,
    trust: new TrustGate(container.trust, container.prompter(command.noInput), container.clock),
    env: command.env,
    codec: mcpCodecFor,
    rules: rulesProjectorFor,
  };
}

export function harnessSession(command: HarnessCommandInput): session.HarnessSession {
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

export function loadHarnessCommand(
  command: HarnessCommandInput,
): ReturnType<typeof session.loadHarnessCommand> {
  return session.loadHarnessCommand(harnessSession(command));
}

export function canMcp(
  command: HarnessCommandInput & {
    readonly name: string;
    readonly agent?: string | undefined;
    readonly envName?: string | undefined;
  },
): ReturnType<typeof session.canMcp> {
  return session.canMcp({
    ...harnessSession(command),
    name: command.name,
    agent: command.agent,
    envName: command.envName,
  });
}

export function inspectMcp(
  command: HarnessCommandInput & { readonly name?: string | undefined },
): ReturnType<typeof session.inspectMcp> {
  return session.inspectMcp({ ...harnessSession(command), name: command.name });
}
