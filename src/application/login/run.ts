// Verify setup before acting and retain completed effects when a later step fails
// or needs human input. A retry checks current state before repeating an action.

import {
  asDevkitError,
  DevkitError,
  toEnvelope,
  withPartialResult,
  type ErrorEnvelope,
  type HandoffStep,
} from '../../domain/errors.js';
import type { PreparationAction } from '../../domain/preparation.js';
import type { SetupPlan, SetupStep } from '../../domain/setup/types.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { ServiceOperation } from '../services/operation.js';
import { Tally } from '../tally.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand, type WorkspaceGuidance } from '../workspace/guidance.js';

import { buildPlan } from './collect.js';
import { setupCommandFailure } from './command-failure.js';
import type { LoginDeps } from './deps.js';
import { handoffStep, loginCommand } from './handoff.js';
import { ensureScopeEnvs } from './scope-envs.js';
import { expandHomeIn, Verifier } from './verify.js';

export interface LoginInput {
  readonly mode?: 'login' | 'prepare';
  readonly tools?: readonly string[] | undefined;
  readonly envs?: readonly string[] | undefined;
  readonly skipManual: boolean;
  readonly dryRun: boolean;
  readonly noInput: boolean;
  readonly posture: WritePosture;
}

export type StepResult =
  | 'verified'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'blocked'
  | 'would_run'
  | 'would_ask'
  | 'handoff'
  | 'not_started';

export interface StepRow {
  readonly actions?: readonly PreparationAction[];
  readonly id: string;
  readonly tool: string;
  readonly env: string | null;
  readonly kind: SetupStep['kind'];
  readonly title: string;
  readonly result: StepResult;
  readonly detail: string | null;
  readonly failure?: ErrorEnvelope['error'];
  readonly next_steps?: readonly string[];
  readonly handoff?: HandoffStep;
}

type StepOutcome = Pick<
  StepRow,
  'result' | 'detail' | 'failure' | 'next_steps' | 'handoff' | 'actions'
>;

export const LOGIN_STEP_COLUMNS = ['id', 'kind', 'result', 'detail'] as const;

export interface LoginOutput {
  readonly has_more: false;
  readonly items: readonly StepRow[];
  readonly summary: Readonly<Record<StepResult, number>>;
  readonly problems: SetupPlan['problems'];
}

export class Login {
  private readonly verifier: Verifier;

  constructor(
    private readonly deps: WorkspaceDeps,
    private readonly setup: LoginDeps,
  ) {
    this.verifier = new Verifier(deps, setup);
  }

  async plan(input: Pick<LoginInput, 'tools' | 'envs'>): Promise<SetupPlan> {
    return buildPlan(this.deps, this.setup, {
      ...input,
      scopeEnvs: this.deps.ctx.local.scope?.envs,
    });
  }

  async execute(input: LoginInput): Promise<LoginOutput> {
    this.validatePlan(await this.plan(input), true);
    const scopeEnvs =
      input.mode === 'prepare'
        ? this.deps.ctx.local.scope?.envs
        : await ensureScopeEnvs(this.deps, this.setup.prompter, input);
    const plan = buildPlan(this.deps, this.setup, { ...input, scopeEnvs });
    this.validatePlan(plan);
    return Tally.during(this.deps.activity, 'steps', (steps) =>
      this.run(plan, input, steps.plan(plan.steps.length)),
    );
  }

  private async run(plan: SetupPlan, input: LoginInput, steps: Tally): Promise<LoginOutput> {
    const rows: StepRow[] = [];
    const pending: SetupStep[] = [];
    const undone = new Set<string>();
    const output = (): LoginOutput => ({
      items: rows,
      has_more: false,
      summary: summarize(rows),
      problems: plan.problems,
    });
    for (const [index, step] of plan.steps.entries()) {
      try {
        const outcome = await steps.unit(step.id, () => this.attempt(step, input, undone));
        if (outcome === 'handoff' || outcome.result === 'handoff') {
          pending.push(step);
          rows.push(
            row(
              step,
              outcome === 'handoff'
                ? {
                    result: 'handoff',
                    detail: 'Human input or authorization required',
                    handoff: handoffStep(step),
                  }
                : outcome,
            ),
          );
        } else rows.push(row(step, outcome));
        if (outcome === 'handoff' || (outcome.result !== 'verified' && outcome.result !== 'done'))
          undone.add(step.id);
      } catch (error) {
        const failure = toEnvelope(asDevkitError(error)).error;
        rows.push(
          row(step, {
            result: 'failed',
            detail: failure.message,
            failure,
            next_steps: failure.next_steps,
          }),
        );
        if (input.mode === 'prepare') {
          undone.add(step.id);
          continue;
        }
        for (const remaining of plan.steps.slice(index + 1))
          rows.push(row(remaining, { result: 'not_started', detail: `Stopped after ${step.id}` }));
        throw withPartialResult(error, output());
      }
    }
    if (pending.length > 0 && input.mode !== 'prepare')
      throw withPartialResult(setupRequired(pending, input, this.deps), output());
    return output();
  }

  private validatePlan(plan: SetupPlan, conflictsOnly = false): void {
    const problems = conflictsOnly
      ? plan.problems.filter((problem) => problem.reason === 'step_conflict')
      : plan.problems;
    if (!problems.length) return;
    const conflicts = problems.some((problem) => problem.reason === 'step_conflict');
    throw new DevkitError(
      'config',
      conflicts ? 'SETUP_PLAN_CONFLICT' : 'SETUP_PLAN_INVALID',
      'Setup cannot execute the declared plan',
      {
        hint: problems.map((problem) => `${problem.step}: ${problem.detail}`).join(' '),
        nextSteps: [
          workspaceCommand(this.deps, 'login', '--list'),
          workspaceCommand(this.deps, 'manifest', 'providers'),
        ],
      },
    );
  }

  private async attempt(
    step: SetupStep,
    input: LoginInput,
    undone: ReadonlySet<string>,
  ): Promise<StepOutcome | 'handoff'> {
    const blocker = step.requires.find((dep) => undone.has(dep));
    if (blocker !== undefined) return { result: 'blocked', detail: `${blocker} is not done` };
    if (step.preparation) {
      const prepared = await new ServiceOperation(this.deps, this.setup).execute(
        step,
        input.dryRun,
      );
      const results = {
        unchanged: 'verified',
        configured: 'done',
        planned: 'would_run',
        blocked: 'blocked',
        failed: 'failed',
      } as const;
      return {
        result: results[prepared.status],
        detail: prepared.detail,
        ...(prepared.failure === undefined ? {} : { failure: prepared.failure }),
        ...(prepared.next_steps === undefined ? {} : { next_steps: prepared.next_steps }),
        ...(prepared.actions ? { actions: prepared.actions } : {}),
      };
    }
    const before = await this.verifier.verify(step, { dryRun: input.dryRun });
    if (before.ok) return { result: 'verified', detail: before.detail };
    if (input.mode === 'prepare' && (step.kind !== 'run' || step.phase !== 'prepare'))
      return { result: 'handoff', detail: before.detail, handoff: handoffStep(step) };
    if (step.kind === 'run') return this.runStep(step, input, before.detail);
    if (input.skipManual) return { result: 'skipped', detail: '--skip-manual' };
    if (input.dryRun) return { result: 'would_ask', detail: before.detail };
    if (input.noInput)
      return { result: 'handoff', detail: before.detail, handoff: handoffStep(step) };
    return this.manualStep(step, input);
  }

  private async runStep(
    step: SetupStep,
    input: LoginInput,
    why: string,
  ): Promise<StepOutcome | 'handoff'> {
    const vector = step.run ?? [];
    if (input.dryRun) return { result: 'would_run', detail: vector.join(' ') };
    if (input.mode !== 'prepare' && input.noInput && !this.setup.trust.yes) return 'handoff';
    assertWritable(input.posture, `setup ${step.id}`);
    await this.setup.trust.gate.ensure({
      tool: step.tool,
      workspace: this.deps.ctx.name,
      commandShell: this.deps.commandShell,
      vector,
      label: step.id,
      origin: step.origin,
      yes: this.setup.trust.yes,
      posture: input.posture,
      ...(step.executionEnv
        ? {
            execution: {
              purpose: 'service authentication',
              resource: step.id,
              bindings: step.executionEnv,
            },
          }
        : {}),
    });
    if (!this.setup.trust.yes && input.mode !== 'prepare') {
      const go = await this.setup.prompter.confirm(
        `${describe(step)}\nRun \`${vector.join(' ')}\`?`,
        {
          defaultYes: true,
        },
      );
      if (!go) return { result: 'skipped', detail: 'declined' };
    }
    this.deps.reporter.progress({ id: step.id, state: 'start', detail: vector.join(' ') });
    const run = await this.deps.processRun(expandHomeIn(vector, this.setup.home), {
      interactive: input.mode !== 'prepare' && !input.noInput,
      ...(input.mode === 'prepare' ? { timeoutMs: 120000 } : {}),
      cwd: this.deps.ctx.root,
      env: step.executionEnv,
      diagnostic: { phase: `${step.id} setup` },
    });
    if (run.code !== 0) {
      this.deps.reporter.progress({ id: step.id, state: 'fail', detail: `exit ${run.code}` });
      const failure = setupCommandFailure(run.stderr, run.code);
      return { result: 'failed', detail: failure.message, failure, next_steps: failure.next_steps };
    }
    return this.settle(step, why);
  }

  private async manualStep(
    step: SetupStep,
    input: LoginInput,
  ): Promise<{ result: StepResult; detail: string | null }> {
    assertWritable(input.posture, `setup ${step.id}`);
    await this.setup.prompter.pause(`${describe(step)}\nPress Enter when done.`);
    const outcome = await this.settle(step, 'not verified');
    if (outcome.result === 'done') await this.acknowledge(step);
    return outcome;
  }

  private async settle(
    step: SetupStep,
    why: string,
  ): Promise<{ result: StepResult; detail: string | null }> {
    const after = await this.verifier.verify(step);
    this.deps.reporter.progress({
      id: step.id,
      state: after.ok ? 'done' : 'fail',
      detail: after.detail,
    });
    return after.ok
      ? { result: 'done', detail: after.detail }
      : { result: 'failed', detail: after.detail || why };
  }

  private async acknowledge(step: SetupStep): Promise<void> {
    await this.deps.localStore.update(this.deps.ctx.name, (local) => ({
      ...local,
      setup: { ...local.setup, [step.id]: { acknowledged: this.setup.clock.now().toISOString() } },
    }));
  }
}

export function describe(step: SetupStep): string {
  const lines = [`${step.title} (${step.id})`];
  if (step.instructions !== undefined) lines.push(step.instructions);
  if (step.open !== undefined) lines.push(`Open: ${step.open}`);
  if (step.expects !== undefined) lines.push(`Expected: ${step.expects.path}`);
  return lines.join('\n');
}

function setupRequired(
  pending: readonly SetupStep[],
  input: LoginInput,
  context: WorkspaceGuidance,
): DevkitError {
  const command = loginCommand(pending, context);
  return new DevkitError(
    'config',
    'LOGIN_REQUIRED',
    `${pending.length} setup step${pending.length === 1 ? '' : 's'} remain${pending.length === 1 ? 's' : ''}: ${pending.map((s) => s.id).join(', ')}`,
    {
      hint: input.noInput
        ? 'Review handoff.user_steps for authorized local preparation and human interaction; verify after input changes, then resume the original task.'
        : 'Run the command below in a terminal to be guided through them.',
      nextSteps: [command, workspaceCommand(context, 'doctor')],
      handoff: {
        summary: `${pending.length} unfinished setup step${pending.length === 1 ? '' : 's'}`,
        userSteps: pending.map(handoffStep),
        command,
        alternatives: [
          workspaceCommand(context, 'login', '--list'),
          workspaceCommand(context, 'doctor'),
        ],
      },
    },
  );
}

function row(step: SetupStep, outcome: StepOutcome): StepRow {
  return {
    id: step.id,
    tool: step.tool,
    env: step.env ?? null,
    kind: step.kind,
    title: step.title,
    ...outcome,
  };
}

function summarize(rows: readonly StepRow[]): Record<StepResult, number> {
  const summary: Record<StepResult, number> = {
    verified: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    would_run: 0,
    would_ask: 0,
    handoff: 0,
    not_started: 0,
  };
  for (const r of rows) summary[r.result] += 1;
  return summary;
}
