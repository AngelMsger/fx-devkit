// Hook commands use registry-only workspace resolution, so broken manifests
// do not prevent disabling or repairing lifecycle entry points.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CleanupAgentHooks } from '../application/hook/cleanup.js';
import type { HookSession } from '../application/hook/session.js';
import type { HookDeps } from '../application/hook/types.js';
import type { WritePosture } from '../application/safety/posture.js';
import type { ResolveInput } from '../application/workspace/resolve.js';
import { FileHookState } from '../infra/hook-state.js';
import type { AgentCleanup } from '../ports/agent-cleanup.js';
import type { HookStateStore } from '../ports/hook-state.js';

import type { Container } from './container.js';
import { hookProtocolFor } from './registry.js';

export function hookStateStore(container: Container): HookStateStore {
  return new FileHookState(container.fxHome);
}

export function hookDeps(container: Container): HookDeps {
  return {
    hosts: container.agents,
    local: container.localStore,
    state: hookStateStore(container),
    lock: container.lock,
    files: container.projections,
    protocol: hookProtocolFor,
    home: container.fxHome,
    executable: [
      process.execPath,
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/fx.js'),
    ],
  };
}

export interface HookSessionInput {
  readonly container: Container;
  readonly resolve: ResolveInput;
  readonly env: NodeJS.ProcessEnv;
  readonly posture: WritePosture;
}

export function hookSession(input: HookSessionInput): HookSession {
  return {
    deps: hookDeps(input.container),
    config: input.container.config,
    resolve: input.resolve,
    env: input.env,
    posture: input.posture,
  };
}

export function agentHookCleanup(
  container: Container,
  env: NodeJS.ProcessEnv,
  posture: WritePosture,
): AgentCleanup {
  const usecase = new CleanupAgentHooks(hookDeps(container), {
    config: container.config,
    fs: container.fs,
    manifestDirFor: container.manifestDirFor,
  });
  return {
    plan: (ids) => usecase.execute({ ids, env, posture, dryRun: true }),
    apply: (ids) => usecase.execute({ ids, env, posture, dryRun: false }),
  };
}
