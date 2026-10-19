// What a sync is asked to do and what it reports: one row per repository, and
// one summary per resource stage. Stages are registered by id, so a stage this
// release does not implement is reported as such rather than silently skipped.

import type { ErrorEnvelope } from '../../domain/errors.js';
import type { EffectOutcome } from '../../domain/outcome.js';
import type { Preparation } from '../../domain/preparation.js';
import type { Finding } from '../../domain/report.js';
import type { PlanItem } from '../../domain/workspace/plan.js';
import type { RenderedFile } from '../docs/rendered.js';
import type { HarnessStageDetails } from '../harness/types.js';
import type { HookStageDetails } from '../hook/types.js';
import type { SetupStageDetails } from '../login/stage.js';
import type { StageSummary } from '../preparation.js';
import type { WritePosture } from '../safety/posture.js';
import type { ServiceStageDetails } from '../services/types.js';
import type { SkillStageOutput } from '../skill/types.js';
import type { ToolStatus } from '../tool/check.js';
import type { InstalledTool } from '../tool/installed.js';
import type { GoWorkOutput } from '../workspace/go-work.js';

export type SyncStage = string;

// Native activation stays optional: a failure in one of these stages is reported
// without stopping a full sync or blocking its preparation.
const ADVISORY_STAGES: readonly SyncStage[] = ['hooks', 'mcp'];

export function isAdvisoryStage(stage: SyncStage): boolean {
  return ADVISORY_STAGES.includes(stage);
}

export interface DocsStageDetails {
  readonly files: readonly RenderedFile[];
  readonly rules?: HarnessStageDetails;
}

export type GoStageDetails = GoWorkOutput;

export type SkillStageDetails = Omit<SkillStageOutput, 'summary'>;

interface PreparationRequirement {
  readonly preparation_required: boolean;
}

export interface ToolStageDetails {
  readonly items: readonly (ToolStatus & PreparationRequirement)[];
  readonly problems: readonly Finding[];
  readonly installations: readonly (InstalledTool & PreparationRequirement)[];
}

// What each resource stage reports beside its summary, under the id it runs by.
export interface ResourceStageDetails {
  readonly services: ServiceStageDetails;
  readonly setup: SetupStageDetails;
  readonly docs: DocsStageDetails;
  readonly go: GoStageDetails;
  readonly skills: SkillStageDetails;
  readonly hooks: HookStageDetails;
  readonly mcp: HarnessStageDetails;
  readonly tools: ToolStageDetails;
}

export type ResourceStage = keyof ResourceStageDetails;

// A stage that failed reports what its error retained, and the failure itself.
export type FailedStageDetails = Readonly<Record<string, unknown>> & {
  readonly failure: ErrorEnvelope['error'];
};

// The repository stage reports its rows as `items`; only its failure appears here.
export type StageDetails = {
  readonly [Stage in ResourceStage]?: ResourceStageDetails[Stage] | FailedStageDetails;
} & { readonly repos?: FailedStageDetails };

export interface SyncInput {
  readonly initializing?: boolean;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly jobs: number;
  readonly only?: SyncStage | readonly SyncStage[] | undefined;
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
  readonly stage_details?: StageDetails;
}
