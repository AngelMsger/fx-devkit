// The setup vocabulary: a provider's template for one readiness step, the concrete
// step the planner makes of it, and the preparation an adapter may attach.

export interface JsonExpectation {
  readonly path: string;
  readonly equals: string | number | boolean | null;
  // A bundled recipe may name the field in which the same response says why,
  // and say in its own words what an unmet expectation means.
  readonly reason?: string;
  readonly unmet?: string;
}

export type SetupCheck =
  | { readonly command: readonly string[]; readonly json?: JsonExpectation | undefined }
  | { readonly file: string }
  | { readonly provider: 'whoami' };

// Adapter-produced preparation contains only public settings, never credentials.
export type ServicePreparation =
  | {
      readonly kind: 'command';
      readonly resource: string;
      readonly minVersion: string;
      // Creates the context the way the declaration proposes.
      readonly command: readonly string[];
      // Its dry run tells whether an existing context already serves the declared
      // service, whatever else it was set up with.
      readonly agrees: readonly string[];
    }
  | {
      readonly kind: 'file';
      readonly relative: string;
      readonly text: string;
      readonly publicDefaults: Readonly<Record<string, string>>;
    };

export interface SetupRecipe {
  readonly phase?: 'prepare' | 'authenticate';
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
  readonly phase?: 'prepare' | 'authenticate';
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

export const SETUP_STEP_COLUMNS = ['id', 'kind', 'title', 'origin'] as const;

export interface SetupPlan {
  readonly steps: readonly SetupStep[];
  readonly problems: readonly PlanProblem[];
}
