// Recording reuses the workspace's live query ports and the shared guarded
// projection writer; it does not introduce another platform execution path.

import type { LoginDeps } from '../application/login/deps.js';
import type { RecordProbeInput, RecordProbeOutput } from '../application/probe-record/types.js';
import { RecordProbe } from '../application/record-probe.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';
import { FileProjectionStore } from '../infra/projection-store.js';

import type { Container } from './container.js';

interface RecordingCommand {
  readonly container: Container;
  readonly workspace: WorkspaceDeps;
  readonly login: LoginDeps;
  readonly input: RecordProbeInput;
}

export function recordProbe(input: RecordingCommand): Promise<RecordProbeOutput> {
  return new RecordProbe({
    workspace: input.workspace,
    login: input.login,
    files: new FileProjectionStore(input.container.lock),
    lock: input.container.lock,
    clock: input.container.clock,
  }).execute(input.input);
}
