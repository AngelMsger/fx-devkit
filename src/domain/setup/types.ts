// The setup vocabulary: a provider's template for one readiness step, and the concrete
// step the planner makes of it.

import type { ServicePreparation } from './service.js';

export interface JsonExpectation {
  readonly path: string;
  readonly equals: string | number | boolean | null;
}

export type SetupCheck =
  | { readonly command: readonly string[]; readonly json?: JsonExpectation | undefined }
  | { readonly file: string }
  | { readonly provider: 'whoami' };

export interface SetupRecipe {
  readonly id: string;
  readonly tool: string;
  readonly perEnv: boolean;
  readonly kind: 'run' | 'manual' | 'file';
  readonly title: string;
  readonly run?: readonly string[];
  readonly instructions?: string;
  readonly open?: string;
  readonly expects?: { readonly path: string };
  readonly verify: SetupCheck;
  readonly requires?: readonly string[];
  // Values for variables an environment may leave out, e.g. namespace.
  readonly defaults?: Readonly<Record<string, string>>;
}

// One concrete step: variables substituted, the tool's binary in front of
// every vector, and an id that local.setup and doctor can refer to.
export interface SetupStep {
  readonly id: string;
  readonly tool: string;
  readonly env?: string;
  readonly kind: 'run' | 'manual' | 'file';
  readonly title: string;
  readonly run?: readonly string[];
  readonly instructions?: string;
  readonly open?: string;
  readonly expects?: { readonly path: string };
  readonly verify: SetupCheck;
  readonly requires: readonly string[];
  readonly origin: 'base' | 'patch';
  readonly required: boolean;
  readonly preparation?: ServicePreparation;
  readonly executionEnv?: Readonly<Record<string, string>>;
}

export type PlanProblemReason =
  'missing_vars' | 'tool_unknown' | 'requires_unknown' | 'requires_cycle' | 'step_conflict';

export interface PlanProblem {
  readonly step: string;
  readonly reason: PlanProblemReason;
  readonly detail: string;
}

export interface SetupPlan {
  readonly steps: readonly SetupStep[];
  readonly problems: readonly PlanProblem[];
}
