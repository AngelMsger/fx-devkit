// The three Skill product lines report one row per item: a linked team Skills
// directory, a copied fx Skill, or an external tool asked to install its own.

import type { EffectOutcome } from '../../domain/outcome.js';
import type {
  CopyAction,
  CopyObservation,
  LinkAction,
  LinkObservation,
} from '../../domain/skills/projection.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';
import type { WritePosture } from '../safety/posture.js';

export interface SkillStageInput {
  readonly background?: boolean;
  readonly replace?: ReplaceFiles;
  readonly agents?: readonly string[] | undefined;
  readonly toolchain?: readonly ResolvedTool[] | undefined;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface ItemOutcome {
  readonly status?: EffectOutcome;
  readonly failure?: Readonly<Record<string, unknown>>;
}

export interface SkillLinkItem extends ItemOutcome {
  readonly agent: string;
  readonly path: string;
  readonly target: string;
  readonly action: LinkAction;
  readonly reason?: string;
}

export interface FxSkillItem extends ItemOutcome {
  readonly agent: string;
  readonly path: string;
  readonly action: CopyAction;
  readonly version: string;
}

export interface ToolSkillItem extends ItemOutcome {
  readonly tool: string;
  readonly vector: readonly string[] | null;
  readonly code: number | null;
  readonly note?: string;
  readonly failure?: Readonly<Record<string, unknown>>;
  readonly origin: ResolvedTool['origins']['skill'];
}

export interface SkillStageOutput {
  readonly links: readonly SkillLinkItem[];
  readonly fx: readonly FxSkillItem[];
  readonly tools: readonly ToolSkillItem[];
  readonly summary: Readonly<Record<string, number>>;
}

// What is on disk where a planned item points; unknown when it could not be read.
type Observed<Item, Observation> = Item & {
  readonly observed: Observation | { readonly kind: 'unknown' };
};

export interface ObservedSkills {
  readonly links: readonly Observed<SkillLinkItem, LinkObservation>[];
  readonly fx: readonly Observed<FxSkillItem, CopyObservation>[];
}
