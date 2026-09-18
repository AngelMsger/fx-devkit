// What a sync is asked to do and what it reports: one row per repository, and
// one summary per resource stage. Stages are registered by id, so a stage this
// release does not implement is reported as such rather than silently skipped.

import type { ErrorEnvelope } from '../../domain/errors.js';
import type { PlanItem } from '../../domain/workspace/plan.js';
import type { WritePosture } from '../safety/posture.js';

export type SyncStage = string;

export type StageSummary = Readonly<Record<string, number | string>>;

export interface StageResult {
  readonly summary: StageSummary;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SyncStages {
  readonly [id: string]: (() => Promise<StageResult>) | undefined;
}

export interface SyncInput {
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly jobs: number;
  readonly only?: SyncStage | readonly SyncStage[] | undefined;
  readonly stages?: SyncStages | undefined;
}

export interface SyncItem extends PlanItem {
  readonly result: 'planned' | 'done' | 'skipped' | 'failed';
  readonly outcome?: string;
  readonly origin_added?: boolean;
  readonly upstream_added?: boolean;
  readonly error?: string;
  readonly failure?: ErrorEnvelope['error'];
}

export const SYNC_COLUMNS = ['name', 'action', 'result', 'outcome', 'reason'] as const;

export interface SyncSummary {
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  readonly unreadable: number;
}

export interface SyncOutput {
  readonly operation: 'preview' | 'apply';
  readonly preparation_complete: boolean | null;
  readonly items: readonly SyncItem[];
  readonly summary: SyncSummary;
  readonly stages: Readonly<Record<string, StageSummary | 'not_implemented'>>;
  readonly stage_details?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
