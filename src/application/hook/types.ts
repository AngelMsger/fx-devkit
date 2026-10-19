// Hook plans and results name the host and its projection path, never its contents.

import type { HandoffEnvelope } from '../../domain/errors.js';
import type { HookAction } from '../../domain/harness/actions.js';
import type { HookSupport } from '../../domain/harness/hooks.js';
import type { HookReceipt, HookState } from '../../domain/harness/state.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { HookProtocol } from '../../ports/hook-protocol.js';
import type { HookStateStore } from '../../ports/hook-state.js';
import type { Lock } from '../../ports/lock.js';
import type { ProjectionSnapshot, ProjectionStore } from '../../ports/projection.js';
import type { LocalLayerStore } from '../../ports/stores.js';
import type { WritePosture } from '../safety/posture.js';

export interface HookDeps {
  readonly hosts: readonly AgentHost[];
  readonly local: LocalLayerStore;
  readonly state: HookStateStore;
  readonly lock: Lock;
  readonly files: ProjectionStore;
  readonly protocol: (support: HookSupport) => HookProtocol;
  readonly executable: readonly string[];
  readonly home: string;
}

export interface ReconcileInput {
  readonly workspace: string;
  readonly root: string;
  readonly action: 'inspect' | 'inject' | 'remove' | 'sync';
  readonly globalEnabled: boolean;
  readonly configured: readonly string[] | undefined;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly removeAgents?: readonly string[];
  readonly ownershipRoot?: string;
}

export interface HookRow {
  readonly activation: 'unverified' | 'unsupported' | 'disabled';
  readonly handoff: HandoffEnvelope | null;
  readonly agent: string;
  readonly path: string | null;
  readonly context: HookSupport['context'] | null;
  readonly action: HookAction;
  readonly command: string | null;
}

export const HOOK_COLUMNS = [
  'agent',
  'action',
  'activation',
  'path',
  'context',
  'command',
] as const;

export interface HookOutput {
  readonly workspace: string;
  readonly root: string;
  readonly items: readonly HookRow[];
  readonly enabled: boolean;
  readonly state: HookState | null;
}

export type HookStageDetails = Pick<HookOutput, 'items'>;

export interface PlannedHook {
  readonly row: HookRow;
  readonly receipt: HookReceipt | null;
  readonly before: ProjectionSnapshot;
  readonly text: string | null;
}

export interface HookPlan {
  readonly workspace: string;
  readonly root: string;
  readonly plans: readonly PlannedHook[];
  readonly enabled: boolean;
  readonly state: HookState | null;
}
