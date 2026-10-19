// What a sync is asked to do and what it reports: one row per repository, and
// one summary per resource stage. Stages are registered by id, so a stage this
// release does not implement is reported as such rather than silently skipped.

import type { ErrorEnvelope } from '../../domain/errors.js';
import type { EffectOutcome } from '../../domain/outcome.js';
import type { Preparation, PreparationCheck } from '../../domain/preparation.js';
import type { PlanItem } from '../../domain/workspace/plan.js';
import type { WritePosture } from '../safety/posture.js';

export type SyncStage = string;

// Native activation stays optional: a failure in one of these stages is reported
// without stopping a full sync or blocking its preparation.
const ADVISORY_STAGES: readonly SyncStage[] = ['hooks', 'mcp'];

export function isAdvisoryStage(stage: SyncStage): boolean {
  return ADVISORY_STAGES.includes(stage);
}

export type StageSummary = Readonly<Record<string, number | string>>;

export interface StageResult {
  readonly checks: readonly PreparationCheck[];
  // Explicit stage selection requires its requested effects, while native activation stays advisory.
  readonly operationChecks?: readonly PreparationCheck[];
  readonly summary: StageSummary;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SyncStages {
  readonly [id: string]: (() => Promise<StageResult>) | undefined;
}

export interface SyncInput {
  readonly initializing?: boolean;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly jobs: number;
  readonly only?: SyncStage | readonly SyncStage[] | undefined;
  readonly stages?: SyncStages | undefined;
}

export interface SyncItem extends PlanItem {
  readonly result: Exclude<EffectOutcome, 'not_started'>;
  readonly outcome?: string;
  readonly origin_added?: boolean;
  readonly upstream_added?: boolean;
  readonly error?: string;
  readonly failure?: ErrorEnvelope['error'];
}

export interface SyncSummary {
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  readonly unreadable: number;
}

export interface SyncOutput {
  readonly operation: 'preview' | 'apply';
  readonly preparation: Preparation;
  readonly items: readonly SyncItem[];
  readonly summary: SyncSummary;
  readonly stages: Readonly<Record<string, StageSummary | 'not_implemented'>>;
  readonly stage_details?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
