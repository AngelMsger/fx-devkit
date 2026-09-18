// Probe recording separates a conditional plan from the observed result and
// carries exact source snapshots until its final guarded write.

import type { HandoffEnvelope } from '../../domain/errors.js';
import type { Environments, Workspace } from '../../domain/manifest/types.js';
import type { Confidence } from '../../domain/obs/confidence.js';
import type { Clock } from '../../ports/clock.js';
import type { Lock } from '../../ports/lock.js';
import type { ProjectionSnapshot, ProjectionStore } from '../../ports/projection.js';
import type { LoginDeps } from '../login/deps.js';
import type { WritePosture } from '../safety/posture.js';
import type { WhereInput, WhereRow } from '../where.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

export interface ProbeRecordDeps {
  readonly workspace: WorkspaceDeps;
  readonly login: LoginDeps;
  readonly files: ProjectionStore;
  readonly clock: Clock;
  readonly lock: Lock;
}

export interface ProbeRecordInput extends WhereInput {
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface ProbeRecordOutput {
  readonly action: 'preview' | 'recorded' | 'unchanged' | 'skipped';
  readonly file: string;
  readonly scope: 'environment' | 'repository' | null;
  readonly path: readonly string[] | null;
  readonly before: Confidence | null;
  readonly after: Confidence | null;
  readonly note: string | null;
  readonly row: WhereRow;
  readonly written: boolean;
  readonly handoff: HandoffEnvelope | null;
}

export interface ProbeRecordPlan {
  readonly output: ProbeRecordOutput;
  readonly workspaceSnapshot: ProjectionSnapshot;
  readonly environmentSnapshot: ProjectionSnapshot;
  readonly workspace: Workspace;
  readonly environments: Environments;
  readonly template: readonly string[] | null;
  readonly previousNote: string;
}
