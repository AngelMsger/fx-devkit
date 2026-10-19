// Initialization and every explicit sync perform local preparation, so a login the
// person already has is associated without anyone asking for it. Personal sign-in and
// operator-owned files always remain explicit handoffs.
import path from 'node:path';

import type { HandoffStep } from '../../domain/errors.js';
import {
  preparationCheck,
  type PreparationAction,
  type PreparationCheck,
} from '../../domain/preparation.js';
import type { Finding } from '../../domain/report.js';
import { gaveNoAnswer, unansweredSteps } from '../../domain/setup/progress.js';
import { isLocalPreparation, type CheckCause, type SetupStep } from '../../domain/setup/types.js';
import {
  noAnswerAction,
  resumeAction,
  unreachableAction,
  verifyAction,
  type StageResult,
} from '../preparation.js';
import type { WritePosture } from '../safety/posture.js';
import { workspaceToolScope } from '../tool/scope.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import type { LoginDeps } from './deps.js';
import { expectedPath } from './handoff.js';
import { isSettled, Login, type LoginOutput, type StepRow } from './run.js';
import { expandHome } from './verify.js';

export type SetupStageDetails = Pick<LoginOutput, 'items' | 'problems'>;

export async function prepareWorkspaceSetup(
  deps: WorkspaceDeps,
  login: LoginDeps,
  input: {
    // Initialization hands an unfinished step back to itself; a later sync to doctor.
    readonly initializing: boolean;
    readonly dryRun: boolean;
    readonly posture: WritePosture;
  },
): Promise<StageResult<SetupStageDetails>> {
  const scope = workspaceToolScope(deps.ctx, {});
  const useCase = new Login(deps, login);
  const plan = await useCase.plan({ tools: scope.configuredNames });
  const output = await useCase.execute({
    tools: scope.configuredNames,
    mode: 'prepare',
    skipManual: false,
    dryRun: input.dryRun,
    noInput: true,
    posture: input.posture,
  });
  const codes = new Map(output.items.map((item) => [item.id, item.failure?.code]));
  const unanswered = unansweredSteps(plan.steps, (step) => gaveNoAnswer(codes.get(step.id)));
  return {
    summary: output.summary,
    details: { items: output.items, problems: output.problems },
    checks: [
      ...output.items.map((item) =>
        stepCheck(deps, login, item, {
          step: plan.steps.find((step) => step.id === item.id)!,
          required: scope.required.has(item.tool),
          unknown: unanswered.has(item.id),
          initializing: input.initializing,
        }),
      ),
      ...output.problems.map((problem) =>
        preparationCheck(`setup:${problem.step}`, 'blocked', problem.detail, {
          owner: 'maintainer',
        }),
      ),
    ],
  };
}

// One step's row as a preparation check, keeping why it is pending and what it waits on.
function stepCheck(
  deps: WorkspaceDeps,
  login: LoginDeps,
  item: StepRow,
  context: {
    readonly step: SetupStep;
    readonly required: boolean;
    readonly unknown: boolean;
    readonly initializing: boolean;
  },
): PreparationCheck {
  const { step, unknown } = context;
  const ready = isSettled(item.result);
  const expected = ready || unknown ? undefined : expectedFile(deps, step, login.home);
  const detail = `${item.title}: ${item.detail ?? item.result}${expected === undefined ? '' : `; expected ${expected}`}`;
  const pending = unknown ? 'unknown' : 'blocked';
  const check = ready ? undefined : item.handoff?.check;
  const cause = check?.result === 'failed' ? check.cause : undefined;
  const { initializing } = context;
  return preparationCheck(`login:${item.id}`, ready ? 'ready' : pending, detail, {
    resource: item.id,
    required: context.required,
    owner: unknown || (isLocalPreparation(step) && !settled(item)) ? 'agent' : 'user',
    ...(cause === undefined ? {} : { cause }),
    ...(check?.result === 'blocked' ? { waits_on: `login:${check.by}` } : {}),
    ...(ready
      ? {}
      : {
          actions:
            item.actions ??
            actionsFor(deps, step, login.home, { item, unknown, cause, initializing }),
        }),
    ...(item.failure ? { failure: item.failure, code: item.failure.code } : {}),
  });
}

// A preparation step whose companion said running it again will not help is the person's:
// repairing it would repeat the failure, and signing in would wait on it again. What
// resolves it is the companion's own recovery, which its failure carries.
function settled(item: Pick<StepRow, 'failure'>): boolean {
  return item.failure !== undefined && !item.failure.retryable;
}

// A check that gave no answer offers its own recovery; a step waiting on it offers none.
// A server that cannot be reached is checked again once the network is back; no sign-in
// would change it.
function actionsFor(
  deps: WorkspaceDeps,
  step: SetupStep,
  home: string,
  row: {
    readonly item: Pick<StepRow, 'failure' | 'handoff'>;
    readonly unknown: boolean;
    readonly cause: CheckCause | undefined;
    readonly initializing: boolean;
  },
): PreparationAction[] {
  const code = row.item.failure?.code;
  if (code !== undefined && gaveNoAnswer(code)) return [noAnswerAction(deps, step, code)];
  if (row.unknown) return [];
  if (row.cause === 'network') return [unreachableAction(deps, step)];
  if (!isLocalPreparation(step) && code === 'VECTOR_UNTRUSTED')
    return [verifyAction(deps, step.tool)];
  const { initializing, item } = row;
  if (isLocalPreparation(step) && settled(item)) return [];
  return setupActions(deps, step, home, { initializing, handoff: item.handoff });
}

// The handoff a finding already carries for a step, with what its check said.
export function handoffOf(
  finding: Pick<Finding, 'handoff'>,
  step: SetupStep,
): HandoffStep | undefined {
  return finding.handoff?.user_steps.find((item) => item.id === step.id);
}

function expectedFile(deps: WorkspaceDeps, step: SetupStep, home: string): string | undefined {
  const expected = expectedPath(step);
  return expected === undefined
    ? undefined
    : path.resolve(deps.ctx.root, expandHome(expected, home));
}

export function setupActions(
  deps: WorkspaceDeps,
  step: SetupStep,
  home: string,
  options: { readonly initializing?: boolean; readonly handoff?: HandoffStep | undefined } = {},
): PreparationAction[] {
  const { initializing = false, handoff } = options;
  const expected = expectedFile(deps, step, home);
  if (isLocalPreparation(step)) {
    const resume = resumeAction({ workspace: deps.ctx.name, cwd: deps.ctx.root });
    return [
      {
        ...resume,
        id: `approve:${step.id}`,
        description: initializing
          ? 'Review the remaining initialization effects and continue this workspace'
          : `Repair ${step.tool}'s local preparation and the workspace's managed guides and Skills`,
        argv: initializing
          ? [...resume.argv, '--yes']
          : ['fx', 'doctor', '--fix', '--tool', step.tool, '--workspace', deps.ctx.name, '--yes'],
        requires_approval: true,
      },
    ];
  }
  return [
    {
      id: `login:${step.id}`,
      description: `${handoff?.instructions ?? step.instructions ?? step.title}${expected === undefined ? '' : ` Expected file: ${expected}.`}`,
      argv: [
        'fx',
        'login',
        step.tool,
        '--workspace',
        deps.ctx.name,
        ...(step.env ? ['--env', step.env] : []),
      ],
      cwd: deps.ctx.root,
      actor: 'user',
      requires_approval: true,
    },
  ];
}
