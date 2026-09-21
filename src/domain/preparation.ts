// Explicit preparation evidence shared by initialization, synchronization and diagnostics.
// Optional capabilities remain visible without deciding whether required work is usable.
import type { ErrorEnvelope } from './errors.js';

export interface PreparationAction {
  readonly actor: 'agent' | 'user';
  readonly env?: Readonly<{
    FX_HOME: string;
    HOME: string;
    USERPROFILE: string;
    FX_AGENTS?: string;
  }>;
  readonly id: string;
  readonly description: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly requires_approval: boolean;
}

export interface PreparationCheck {
  readonly id: string;
  readonly resource: string;
  readonly state: 'ready' | 'blocked' | 'unknown' | 'skipped';
  readonly required: boolean;
  readonly code: string;
  readonly message: string;
  readonly owner: 'agent' | 'user' | 'maintainer' | 'external';
  readonly actions?: readonly PreparationAction[];
  readonly failure?: ErrorEnvelope['error'];
}

export interface PreparationScope {
  readonly workspace: string;
  readonly stages: readonly string[];
  readonly repositories: readonly string[];
  readonly tools: readonly string[];
  readonly environments: readonly string[];
}

export interface Preparation {
  readonly state: 'planned' | 'ready' | 'incomplete';
  readonly next: {
    readonly kind: 'review' | 'complete' | 'act' | 'handoff';
    readonly message: string;
  };
  readonly scope: PreparationScope;
  readonly completed: readonly string[];
  readonly blockers: readonly PreparationCheck[];
  readonly warnings: readonly PreparationCheck[];
  readonly unchecked: readonly PreparationCheck[];
  readonly next_actions: readonly PreparationAction[];
  readonly resume: PreparationAction | null;
}

export function preparation(input: {
  readonly scope: PreparationScope;
  readonly checks: readonly PreparationCheck[];
  readonly preview?: boolean;
  readonly resume?: PreparationAction | null;
}): Preparation {
  const checks = [...new Map(input.checks.map((check) => [check.id, check])).values()];
  const pending = checks.filter((check) => check.state === 'blocked' || check.state === 'unknown');
  const blockers = pending.filter((check) => check.required);
  const actions = blockers
    .flatMap((check) => check.actions ?? [])
    .filter((action) => action.actor === 'agent');
  const resume = blockers.length > 0 ? (input.resume ?? null) : null;
  let state: Preparation['state'] = blockers.length > 0 ? 'incomplete' : 'ready';
  if (input.preview) state = 'planned';
  return {
    state,
    next: nextDecision(state, actions),
    scope: input.scope,
    completed: input.preview
      ? []
      : checks.filter((check) => check.state === 'ready').map((check) => check.id),
    blockers,
    warnings: pending.filter((check) => !check.required),
    unchecked: checks.filter((check) => check.state === 'unknown'),
    next_actions: [
      ...new Map(
        actions.map((action) => [
          JSON.stringify([action.argv, action.cwd, action.requires_approval]),
          action,
        ]),
      ).values(),
    ],
    resume,
  };
}

function nextDecision(
  state: Preparation['state'],
  actions: readonly PreparationAction[],
): Preparation['next'] {
  if (state === 'planned')
    return {
      kind: 'review',
      message:
        'Review the target and automatic effects, then apply within the existing authorization. Personal sign-in stays with the user.',
    };
  if (state === 'ready')
    return {
      kind: 'complete',
      message:
        'The requested preparation is verified. Continue the original task; no further setup or diagnostic command is needed.',
    };
  if (actions.length)
    return {
      kind: 'act',
      message:
        'Use the listed Agent actions within the existing authorization. Completed preparation stays valid; do not repeat completed setup commands.',
    };
  return {
    kind: 'handoff',
    message:
      'Wait for the listed prerequisites; report the blockers to their owners. Do not repeat completed setup commands. Use resume after the prerequisites change.',
  };
}

export function preparationScope(
  workspace: string,
  stages: readonly string[] = [],
): PreparationScope {
  return { workspace, stages, repositories: [], tools: [], environments: [] };
}

export function preparationCheck(
  id: string,
  state: PreparationCheck['state'],
  message: string,
  options: Partial<Omit<PreparationCheck, 'id' | 'state' | 'message'>> = {},
): PreparationCheck {
  return {
    id,
    resource: id,
    state,
    message,
    required: true,
    code: 'PREPARATION_REQUIRED',
    owner: 'agent',
    ...options,
  };
}
