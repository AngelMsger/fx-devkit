// Verify setup before acting and retain completed effects when a later step fails
// or needs human input. A retry checks current state before repeating an action.

import {
  asDevkitError,
  checkNote,
  DevkitError,
  toEnvelope,
  withPartialResult,
  type ErrorEnvelope,
  type HandoffStep,
} from '../../domain/errors.js';
import type { PreparationAction } from '../../domain/preparation.js';
import { SetupProgress } from '../../domain/setup/progress.js';
import { isLocalPreparation, type SetupPlan, type SetupStep } from '../../domain/setup/types.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { ServiceOperation } from '../services/operation.js';
import { Tally } from '../tally.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand, type WorkspaceGuidance } from '../workspace/guidance.js';

import { buildPlan } from './collect.js';
import { setupCommandFailure } from './command-failure.js';
import type { LoginDeps } from './deps.js';
import { handoffStep, loginCommand } from './handoff.js';
import { noteUnsetEnvScope } from './scope-envs.js';
import { expandHomeIn, stepTrust, Verifier, type CheckVerdict } from './verify.js';

export interface LoginInput {
  readonly mode?: 'login' | 'prepare';
  readonly tools?: readonly string[] | undefined;
  readonly envs?: readonly string[] | undefined;
  readonly skipManual: boolean;
  readonly dryRun: boolean;
  readonly noInput: boolean;
  readonly posture: WritePosture;
}

// What a run decides by whether it guides a person through setup or prepares a workspace
// unattended.
interface RunPolicy {
  readonly notesUnsetEnvScope: boolean;
  readonly continuesAfterFailure: boolean;
  readonly raisesOnPending: boolean;
  // Every other unmet step is handed over.
  readonly runsOnlyLocalPreparation: boolean;
  // Unless --yes was given; where nobody can answer, the command is handed over instead.
  readonly confirmsCommands: boolean;
  readonly lendsTerminal: boolean;
  readonly commandTimeoutMs?: number;
}

const POLICIES: Readonly<Record<NonNullable<LoginInput['mode']>, RunPolicy>> = {
  login: {
    notesUnsetEnvScope: true,
    continuesAfterFailure: false,
    raisesOnPending: true,
    runsOnlyLocalPreparation: false,
    confirmsCommands: true,
    lendsTerminal: true,
  },
  prepare: {
    notesUnsetEnvScope: false,
    continuesAfterFailure: true,
    raisesOnPending: false,
    runsOnlyLocalPreparation: true,
    confirmsCommands: false,
    lendsTerminal: false,
    commandTimeoutMs: 120_000,
  },
};

// The input a run works from: its mode is resolved once, and the steps read the policy.
type RunInput = Omit<LoginInput, 'mode'> & { readonly policy: RunPolicy };

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

// The step's check passes: it already did, or it does since the step was carried out.
export function isSettled(result: StepResult): boolean {
  return result === 'verified' || result === 'done';
}

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
  // What checking a failed step again after a sign-in found, when it still did not pass.
  readonly recheck?: { readonly after: string; readonly detail: string; readonly code?: string };
}

type StepOutcome = Pick<
  StepRow,
  'result' | 'detail' | 'failure' | 'next_steps' | 'handoff' | 'actions'
>;

// What bringing earlier steps up to date after a sign-in reads and records.
interface Reconciling {
  readonly rows: StepRow[];
  readonly progress: SetupProgress;
  readonly input: RunInput;
  readonly steps: Tally;
  readonly record: (index: number, step: SetupStep, outcome: StepOutcome) => void;
}

interface PendingHandoff {
  readonly step: SetupStep;
  readonly handoff: HandoffStep;
}

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
    const plan = await this.plan(input);
    this.validatePlan(plan);
    const { mode = 'login', ...asked } = input;
    const policy = POLICIES[mode];
    if (policy.notesUnsetEnvScope) noteUnsetEnvScope(this.deps, input.envs);
    return Tally.during(this.deps.activity, 'steps', (steps) =>
      this.run(plan, { ...asked, policy }, steps.plan(plan.steps.length)),
    );
  }

  private async run(plan: SetupPlan, input: RunInput, steps: Tally): Promise<LoginOutput> {
    const rows: StepRow[] = [];
    const pending: PendingHandoff[] = [];
    const progress = new SetupProgress();
    const output = (): LoginOutput => ({
      items: rows,
      has_more: false,
      summary: summarize(rows),
      problems: plan.problems,
    });
    const record = (index: number, step: SetupStep, outcome: StepOutcome): void => {
      rows[index] = row(step, outcome);
      if (outcome.result === 'handoff')
        pending.push({ step, handoff: outcome.handoff ?? handoffStep(step) });
      progress.record(step, isSettled(outcome.result) ? 'done' : 'undone');
    };
    const stop = (error: unknown, index: number): Error => {
      for (const remaining of plan.steps.slice(index + 1))
        rows.push(
          row(remaining, {
            result: 'not_started',
            detail: `Stopped after ${plan.steps[index]!.id}`,
          }),
        );
      return withPartialResult(error, output());
    };
    const run: Reconciling = { rows, progress, input, steps, record };
    for (const [index, step] of plan.steps.entries()) {
      let outcome: StepOutcome;
      try {
        const blocker = progress.undonePrerequisite(step);
        outcome = await steps.unit(step.id, () => this.attempt(step, input, blocker));
      } catch (error) {
        const failure = toEnvelope(asDevkitError(error)).error;
        record(index, step, {
          result: 'failed',
          detail: failure.message,
          failure,
          next_steps: failure.next_steps,
        });
        if (input.policy.continuesAfterFailure) continue;
        throw stop(error, index);
      }
      record(index, step, outcome);
      if (step.phase !== 'authenticate' || outcome.result !== 'done') continue;
      try {
        await this.reconcile(plan.steps.slice(0, index), step, run);
      } catch (error) {
        throw stop(error, index);
      }
    }
    if (pending.length > 0 && input.policy.raisesOnPending)
      throw withPartialResult(setupRequired(pending, input, this.deps), output());
    return output();
  }

  // Which other contexts a sign-in also serves is the companion's to know, so the earlier
  // steps of the same tool are brought up to date as soon as it succeeds: one that failed
  // is checked again, and one that waited on a step now passing gets its first attempt.
  // Nothing that already ran runs again.
  private async reconcile(
    earlier: readonly SetupStep[],
    signIn: SetupStep,
    run: Reconciling,
  ): Promise<void> {
    const stale = earlier.flatMap((step, index) => {
      const result = run.rows[index]?.result;
      const behind = result === 'failed' || result === 'blocked';
      return step.tool === signIn.tool && !step.preparation && behind ? [{ step, index }] : [];
    });
    run.steps.plan(stale.length);
    for (const { step, index } of stale)
      await run.steps.unit(step.id, async () => {
        if (run.progress.undonePrerequisite(step) !== undefined) return;
        if (run.rows[index]?.result === 'blocked')
          run.record(index, step, await this.attempt(step, run.input, undefined));
        else await this.checkAgain(step, index, signIn, run);
      });
  }

  // A check that still does not pass, or gives no answer, leaves the step as it was and
  // says what it found; an error fx does not know stops the run like any other.
  private async checkAgain(
    step: SetupStep,
    index: number,
    signIn: SetupStep,
    run: Reconciling,
  ): Promise<void> {
    const note = (detail: string, code?: string): void => {
      const before = run.rows[index]!;
      run.rows[index] = {
        ...before,
        recheck: { after: signIn.id, detail, ...(code === undefined ? {} : { code }) },
      };
    };
    let verdict: CheckVerdict;
    try {
      verdict = await this.verifier.verify(step);
    } catch (error) {
      if (!(error instanceof DevkitError)) throw error;
      return note(error.message, error.code);
    }
    if (!verdict.ok) return note(verdict.detail);
    const detail = `verified again after ${signIn.id}`;
    this.deps.reporter.progress({ id: step.id, state: 'done', detail });
    run.record(index, step, { result: 'verified', detail });
  }

  private validatePlan(plan: SetupPlan): void {
    const problems = plan.problems;
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
    input: RunInput,
    blocker: string | undefined,
  ): Promise<StepOutcome> {
    if (blocker !== undefined)
      return {
        result: 'blocked',
        detail: `${blocker} is not done`,
        handoff: handoffStep(step, { blockedBy: blocker }),
      };
    if (step.preparation) {
      const prepared = await new ServiceOperation(this.deps, this.setup).execute(step, {
        dryRun: input.dryRun,
      });
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
    // What the check just said travels with the step wherever it is handed over.
    const handoff = handoffStep(step, { failed: before });
    const runsUnattended = step.kind === 'run' && isLocalPreparation(step);
    if (input.policy.runsOnlyLocalPreparation && !runsUnattended)
      return { result: 'handoff', detail: before.detail, handoff };
    if (step.kind === 'run') return this.runStep(step, input, { why: before.detail, handoff });
    if (input.skipManual) return { result: 'skipped', detail: '--skip-manual' };
    if (input.dryRun) return { result: 'would_ask', detail: before.detail, handoff };
    if (input.noInput) return { result: 'handoff', detail: before.detail, handoff };
    return this.manualStep(step, input, handoff);
  }

  private async runStep(
    step: SetupStep,
    input: RunInput,
    before: { readonly why: string; readonly handoff: HandoffStep },
  ): Promise<StepOutcome> {
    const { policy } = input;
    const vector = step.run ?? [];
    if (input.dryRun) return { result: 'would_run', detail: vector.join(' ') };
    // Local preparation runs the way init and sync run it: off the terminal, with a
    // deadline, and for a bundled step without asking anyone.
    const local = isLocalPreparation(step);
    const runs = local ? POLICIES.prepare : policy;
    const asks = !local || step.origin !== 'base';
    const confirms = policy.confirmsCommands && asks && !this.deps.trust.yes;
    if (confirms && input.noInput)
      return {
        result: 'handoff',
        detail: 'Human input or authorization required',
        handoff: before.handoff,
      };
    assertWritable(input.posture, `setup ${step.id}`);
    await this.deps.trust.gate.ensure(
      stepTrust(this.deps.trust, step, { vector, label: step.id, posture: input.posture }),
    );
    if (confirms) {
      const go = await this.setup.prompter.confirm(
        `${describe(before.handoff)}\nRun \`${vector.join(' ')}\`?`,
        {
          defaultYes: true,
        },
      );
      if (!go) return { result: 'skipped', detail: 'declined' };
    }
    this.deps.reporter.progress({ id: step.id, state: 'start', detail: vector.join(' ') });
    const run = await this.deps.process.run(expandHomeIn(vector, this.setup.home), {
      interactive: runs.lendsTerminal && !input.noInput,
      ...(runs.commandTimeoutMs === undefined ? {} : { timeoutMs: runs.commandTimeoutMs }),
      cwd: this.deps.ctx.root,
      env: step.executionEnv,
      diagnostic: { phase: `${step.id} setup` },
    });
    if (run.code !== 0) {
      const failure = setupCommandFailure(run.stderr, run.code);
      this.deps.reporter.progress({ id: step.id, state: 'fail', detail: failureLine(failure) });
      return { result: 'failed', detail: failure.message, failure, next_steps: failure.next_steps };
    }
    return this.settle(step, before.why);
  }

  private async manualStep(
    step: SetupStep,
    input: RunInput,
    handoff: HandoffStep,
  ): Promise<StepOutcome> {
    assertWritable(input.posture, `setup ${step.id}`);
    await this.setup.prompter.pause(`${describe(handoff)}\nPress Enter when done.`);
    const outcome = await this.settle(step, 'not verified');
    if (outcome.result === 'done') await this.acknowledge(step);
    return outcome;
  }

  // A step that still fails is read by its check afterwards, not by the one before it.
  private async settle(step: SetupStep, why: string): Promise<StepOutcome> {
    const after = await this.verifier.verify(step);
    this.deps.reporter.progress({
      id: step.id,
      state: after.ok ? 'done' : 'fail',
      detail: after.detail,
    });
    return after.ok
      ? { result: 'done', detail: after.detail }
      : {
          result: 'failed',
          detail: after.detail || why,
          handoff: handoffStep(step, { failed: after }),
        };
  }

  private async acknowledge(step: SetupStep): Promise<void> {
    await this.deps.localStore.update(this.deps.ctx.name, (local) => ({
      ...local,
      setup: { ...local.setup, [step.id]: { acknowledged: this.setup.clock.now().toISOString() } },
    }));
  }
}

export function describe(step: HandoffStep): string {
  const lines = [`${step.title} (${step.id})`];
  const check = checkNote(step);
  if (check !== undefined) lines.push(check);
  if (step.instructions !== undefined) lines.push(step.instructions);
  if (step.open !== undefined) lines.push(`Open: ${step.open}`);
  if (step.expects !== undefined) lines.push(`Expected: ${step.expects.path}`);
  return lines.join('\n');
}

function setupRequired(
  pending: readonly PendingHandoff[],
  input: Pick<LoginInput, 'noInput'>,
  context: WorkspaceGuidance,
): DevkitError {
  const command = loginCommand(
    pending.map((item) => item.step),
    context,
  );
  return new DevkitError(
    'config',
    'LOGIN_REQUIRED',
    `${pending.length} setup step${pending.length === 1 ? '' : 's'} remain${pending.length === 1 ? 's' : ''}: ${pending.map((item) => item.step.id).join(', ')}`,
    {
      hint: input.noInput
        ? 'Review handoff.user_steps for authorized local preparation and human interaction; verify after input changes, then resume the original task.'
        : 'Run the command below in a terminal to be guided through them.',
      nextSteps: [command, workspaceCommand(context, 'doctor')],
      handoff: {
        summary: `${pending.length} unfinished setup step${pending.length === 1 ? '' : 's'}`,
        userSteps: pending.map((item) => item.handoff),
        command,
        alternatives: [
          workspaceCommand(context, 'login', '--list'),
          workspaceCommand(context, 'doctor'),
        ],
      },
    },
  );
}

// A companion's own code says more than the generic one fx falls back to.
function failureLine(failure: ErrorEnvelope['error']): string {
  return failure.code === 'SETUP_COMMAND_FAILED'
    ? failure.message
    : `${failure.message} (${failure.code})`;
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
