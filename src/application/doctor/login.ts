// The check is the truth: a step a person acknowledged still fails when its
// check does, and the finding says both.

import { DevkitError, handoffEnvelope } from '../../domain/errors.js';
import type { SetupStep } from '../../domain/setup/types.js';
import { buildPlan } from '../login/collect.js';
import type { LoginDeps } from '../login/deps.js';
import { handoffStep, loginCommand } from '../login/handoff.js';
import { Verifier } from '../login/verify.js';
import { noAnswerAction, verifyAction } from '../preparation.js';
import { commandTrustHandoff, isTrustRequired } from '../safety/trust.js';
import type { Tally } from '../tally.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand, type WorkspaceGuidance } from '../workspace/guidance.js';

import { finding, type Finding } from './types.js';

export interface LoginCheckOptions {
  readonly tools?: readonly string[] | undefined;
  readonly envs?: readonly string[] | undefined;
  readonly dryRun?: boolean;
  readonly requiredTools?: ReadonlySet<string>;
}

export async function checkLogin(
  deps: WorkspaceDeps,
  login: LoginDeps,
  options: LoginCheckOptions,
  checks: Tally,
): Promise<Finding[]> {
  const plan = buildPlan(deps, login, { ...options, scopeEnvs: deps.ctx.local.scope?.envs });
  const verifier = new Verifier(deps, login);
  const acknowledged = deps.ctx.local.setup ?? {};
  const findings: Finding[] = plan.problems.map((p) =>
    finding('login', p.step, 'warn', `${p.detail} (${p.reason})`, {
      fix: workspaceCommand(deps, 'login', '--list'),
      coverage: 'incomplete',
    }),
  );
  const pending = new Set<string>();
  // Checks that gave no answer, and the steps waiting on them: nobody is handed either.
  const unanswered = new Set<string>();
  const check = async (step: SetupStep): Promise<Finding> => {
    const fix = loginCommand([step], deps);
    const blocker = blockerOf(step, unanswered) ?? blockerOf(step, pending);
    if (blocker) {
      if (unanswered.has(blocker)) unanswered.add(step.id);
      return blockedFinding(step, blocker, deps, unanswered.has(step.id));
    }
    try {
      const verdict = await verifier.verify(
        step,
        options.dryRun === undefined ? {} : { dryRun: options.dryRun },
      );
      if (verdict.ok) return finding('login', step.id, 'ok', verdict.detail);
      const when = acknowledged[step.id]?.acknowledged;
      const message =
        when === undefined
          ? verdict.detail
          : `acknowledged on ${when} but the check fails: ${verdict.detail}`;
      const required = step.required || options.requiredTools?.has(step.tool);
      return finding('login', step.id, when !== undefined || required ? 'fail' : 'warn', message, {
        fix,
        handoff: handoffEnvelope({
          summary: step.title,
          userSteps: [handoffStep(step, { failed: verdict })],
          command: fix,
        }),
        ...(verdict.actions ? { actions: verdict.actions } : {}),
      });
    } catch (err) {
      if (!(err instanceof DevkitError)) throw err;
      if (isTrustRequired(err)) return trustFinding(step, login, err, deps);
      unanswered.add(step.id);
      return unfinishedFinding(step, err, deps);
    }
  };
  checks.plan(plan.steps.length);
  for (const step of plan.steps) {
    const found = await checks.unit(step.id, () => check(step));
    // Whatever keeps a step from passing also withholds the steps that require it.
    if (found.level !== 'ok') pending.add(step.id);
    findings.push(found);
  }
  return findings;
}

// The first prerequisite of a step found in a set. An unanswered one is looked for
// first: it decides what becomes of the step even beside one that failed outright.
function blockerOf(step: SetupStep, among: ReadonlySet<string>): string | undefined {
  return step.requires.find((id) => among.has(id));
}

function trustFinding(
  step: SetupStep,
  login: LoginDeps,
  error: DevkitError,
  deps: WorkspaceDeps,
): Finding {
  const handoff = commandTrustHandoff({
    tool: step.tool,
    posture: login.trust.posture,
    workspace: deps.ctx.name,
    commandShell: deps.commandShell,
  });
  return finding('login', step.id, 'warn', error.message, {
    coverage: 'incomplete',
    fix: handoff.command,
    handoff,
    actions: [verifyAction(deps, step.tool)],
  });
}

// A check that could not run or finish says nothing about sign-in: its tool is the step
// when that did not start, and checking again is otherwise.
function unfinishedFinding(step: SetupStep, error: DevkitError, deps: WorkspaceDeps): Finding {
  const recovery = error.code === 'TOOL_MISSING' ? ['tool', 'install'] : ['doctor', '--tool'];
  return finding('login', step.id, 'warn', error.message, {
    fix: workspaceCommand(deps, ...recovery, step.tool),
    coverage: 'incomplete',
    actions: [noAnswerAction(deps, step, error.code)],
  });
}

// A step behind a check that gave no answer waits for that check, not for a person.
function blockedFinding(
  step: SetupStep,
  blocker: string,
  deps: WorkspaceGuidance,
  unanswered: boolean,
): Finding {
  return finding('login', step.id, 'warn', `Blocked by ${blocker}`, {
    coverage: 'incomplete',
    ...(unanswered
      ? { fix: workspaceCommand(deps, 'doctor', '--tool', step.tool), actions: [] }
      : { fix: loginCommand([step], deps) }),
  });
}
