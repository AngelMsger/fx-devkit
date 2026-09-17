// Where this fx is and what it works with: the paths a person needs when
// something looks wrong, in one record.

import path from 'node:path';

import type { ErrorEnvelope } from '../../domain/errors.js';
import type { WorkspaceRecord } from '../workspace/discover.js';

export interface SelfInfoInput {
  readonly name: string;
  readonly version: string;
  readonly runtime: string;
  readonly fxHome: string;
  readonly configPath: string;
  readonly trustPath: string;
  readonly bundledTools: string;
  readonly bundledSkill: string;
  readonly registry: string | null;
  readonly workspace: WorkspaceInfo | null;
  readonly workspaceError?: ErrorEnvelope['error'] | null;
}

export interface WorkspaceInfo extends Partial<
  Omit<WorkspaceRecord, 'name' | 'root' | 'manifest'>
> {
  readonly name: string;
  readonly root: string;
  readonly manifest: string;
}

export interface SelfInfo {
  readonly name: string;
  readonly version: string;
  readonly runtime: string;
  readonly fx_home: string;
  readonly config: string;
  readonly trust: string;
  readonly cache: string;
  readonly workspaces: string;
  readonly bundled_tools: string;
  readonly bundled_skill: string;
  readonly bundled_skill_version: string;
  readonly registry: string | null;
  readonly workspace: WorkspaceInfo | null;
  readonly workspace_error: ErrorEnvelope['error'] | null;
}

export function selfInfo(input: SelfInfoInput): SelfInfo {
  return {
    name: input.name,
    version: input.version,
    runtime: input.runtime,
    fx_home: input.fxHome,
    config: input.configPath,
    trust: input.trustPath,
    cache: path.join(input.fxHome, 'cache'),
    workspaces: path.join(input.fxHome, 'workspaces'),
    bundled_tools: input.bundledTools,
    bundled_skill: input.bundledSkill,
    bundled_skill_version: input.version,
    registry: input.registry,
    workspace: input.workspace,
    workspace_error: input.workspaceError ?? null,
  };
}
