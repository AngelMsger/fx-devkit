// Initialization and every explicit sync perform local preparation, so a login the
// person already has is associated without anyone asking for it. Personal sign-in and
// operator-owned files always remain explicit handoffs.
import path from 'node:path';

import type { HandoffStep } from '../../domain/errors.js';
import { preparationCheck, type PreparationAction } from '../../domain/preparation.js';
import type { Finding } from '../../domain/report.js';
import type { SetupPlan, SetupStep } from '../../domain/setup/types.js';
import type { LoginDeps } from '../login/deps.js';
import { expectedPath } from '../login/handoff.js';
import { Login, type StepRow } from '../login/run.js';
import { expandHome, gaveNoAnswer } from '../login/verify.js';
import { noAnswerAction, resumeAction, verifyAction } from '../preparation.js';
import type { WritePosture } from '../safety/posture.js';
import type { StageResult } from '../sync/types.js';
import { workspaceToolScope } from '../tool/scope.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

export async function prepareWorkspaceSetup(
  deps: WorkspaceDeps,
  login: LoginDeps,
  input: {
    // Initialization hands an unfinished step back to itself; a later sync to doctor.
    readonly initializing: boolean;
    readonly dryRun: boolean;
    readonly posture: WritePosture;
  },
): Promise<StageResult> {
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
  const unanswered = unansweredSteps(plan, output.items);
  return {
    summary: output.summary,
    details: { items: output.items, problems: output.problems },
    checks: [
      ...output.items.map((item) => {
        const step = plan.steps.find((step) => step.id === item.id)!;
        const ready = item.result === 'verified' || item.result === 'done';
        const unknown = unanswered.has(item.id);
        const expected = ready || unknown ? undefined : expectedFile(deps, step, login.home);
        const detail = `${item.title}: ${item.detail ?? item.result}${expected === undefined ? '' : `; expected ${expected}`}`;
        const pending = unknown ? 'unknown' : 'blocked';
        return preparationCheck(`login:${item.id}`, ready ? 'ready' : pending, detail, {
          resource: item.id,
          required: scope.required.has(item.tool),
          owner: unknown || step.phase === 'prepare' ? 'agent' : 'user',
          ...(ready
            ? {}
            : {
                actions:
                  item.actions ??
                  actionsFor(deps, step, login.home, {
                    item,
                    unknown,
                    initializing: input.initializing,
                  }),
              }),
          ...(item.failure ? { failure: item.failure, code: item.failure.code } : {}),
        });
      }),
      ...output.problems.map((problem) =>
        preparationCheck(`setup:${problem.step}`, 'blocked', problem.detail, {
          owner: 'maintainer',
        }),
      ),
    ],
  };
}

// Steps whose check gave no answer and, the plan listing prerequisites first, the steps
// that wait on them: as unknown as the check, and nobody's to act on.
function unansweredSteps(plan: SetupPlan, items: readonly StepRow[]): ReadonlySet<string> {
  const codes = new Map(items.map((item) => [item.id, item.failure?.code]));
  const unanswered = new Set<string>();
  for (const step of plan.steps)
    if (gaveNoAnswer(codes.get(step.id)) || step.requires.some((id) => unanswered.has(id)))
      unanswered.add(step.id);
  return unanswered;
}

// A check that gave no answer offers its own recovery; a step waiting on it offers none.
function actionsFor(
  deps: WorkspaceDeps,
  step: SetupStep,
  home: string,
  row: {
    readonly item: Pick<StepRow, 'failure' | 'handoff'>;
    readonly unknown: boolean;
    readonly initializing: boolean;
  },
): PreparationAction[] {
  const code = row.item.failure?.code;
  if (code !== undefined && gaveNoAnswer(code)) return [noAnswerAction(deps, step, code)];
  if (row.unknown) return [];
  if (step.phase !== 'prepare' && code === 'VECTOR_UNTRUSTED')
    return [verifyAction(deps, step.tool)];
  const { initializing, item } = row;
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
  if (step.phase === 'prepare') {
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
      actor: 'user',
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
      requires_approval: true,
    },
  ];
}
