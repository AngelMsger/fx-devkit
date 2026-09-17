// Hook commands use registry-only workspace resolution, so broken manifests
// do not prevent disabling or repairing lifecycle entry points.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DoctorExtension } from '../application/doctor/types.js';
import { CleanupAgentHooks } from '../application/hook/cleanup.js';
import {
  type HookDeps,
  type HookOutput,
  type ReconcileInput,
} from '../application/hook/reconcile.js';
import * as session from '../application/hook/session.js';
import type { WritePosture } from '../application/safety/posture.js';
import type { ResolveInput } from '../application/workspace/resolve.js';
import { FileHookState } from '../infra/hook-state.js';
import { FileProjectionStore } from '../infra/projection-store.js';
import type { AgentCleanup } from '../ports/agent-cleanup.js';

import type { Container } from './container.js';
import { hookProtocolFor } from './registry.js';

export function hookDeps(container: Container): HookDeps {
  return {
    hosts: container.agents,
    local: container.localStore,
    state: new FileHookState(container.fxHome),
    lock: container.lock,
    files: new FileProjectionStore(container.lock),
    protocol: hookProtocolFor,
    home: container.fxHome,
    executable: [
      process.execPath,
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/fx.js'),
    ],
  };
}

export interface ManageHooksInput {
  readonly container: Container;
  readonly resolve: ResolveInput;
  readonly env: NodeJS.ProcessEnv;
  readonly action: ReconcileInput['action'];
  readonly posture: WritePosture;
  readonly dryRun: boolean;
}
function hookSession(
  input: Omit<ManageHooksInput, 'action' | 'dryRun'>,
): Omit<session.ManageHooksInput, 'action' | 'dryRun'> {
  return {
    deps: hookDeps(input.container),
    config: input.container.config,
    resolve: input.resolve,
    env: input.env,
    posture: input.posture,
  };
}
export function manageHooks(input: ManageHooksInput): Promise<HookOutput> {
  return session.manageHooks({ ...hookSession(input), action: input.action, dryRun: input.dryRun });
}
export function hookStage(
  input: Omit<ManageHooksInput, 'action'>,
): ReturnType<typeof session.hookStage> {
  return session.hookStage({ ...hookSession(input), dryRun: input.dryRun });
}
export function hookDoctor(input: Omit<ManageHooksInput, 'action' | 'dryRun'>): DoctorExtension {
  return session.hookDoctor(hookSession(input));
}

export function agentHookCleanup(
  container: Container,
  env: NodeJS.ProcessEnv,
  posture: WritePosture,
): AgentCleanup {
  const usecase = new CleanupAgentHooks(
    hookDeps(container),
    container.config,
    container.fs,
    container.manifestDirFor,
  );
  return {
    plan: (ids) => usecase.execute({ ids, env, posture, dryRun: true }),
    apply: (ids) => usecase.execute({ ids, env, posture, dryRun: false }),
  };
}
