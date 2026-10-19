// Recording reuses the workspace's live query ports and the shared guarded
// projection writer; it does not introduce another platform execution path.

import type { LoginDeps } from '../application/login/deps.js';
import { ProbeRecord } from '../application/probe-record/index.js';
import type { ProbeRecordInput, ProbeRecordOutput } from '../application/probe-record/types.js';
import type { WorkspaceDeps } from '../application/workspace/deps.js';

import type { Container } from './container.js';

interface ProbeRecordCommand {
  readonly container: Container;
  readonly workspace: WorkspaceDeps;
  readonly login: LoginDeps;
  readonly input: ProbeRecordInput;
}

export function recordProbe(input: ProbeRecordCommand): Promise<ProbeRecordOutput> {
  return new ProbeRecord({
    workspace: input.workspace,
    login: input.login,
    files: input.container.projections,
    lock: input.container.lock,
    clock: input.container.clock,
  }).execute(input.input);
}
