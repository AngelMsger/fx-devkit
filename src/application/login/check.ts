// The check is the truth: a step a person acknowledged still fails when its
// check does, and the finding says both.

import { DevkitError, handoffEnvelope } from '../../domain/errors.js';
import { finding, type Finding } from '../../domain/report.js';
import { SetupProgress, type HeldBack } from '../../domain/setup/progress.js';
import type { SetupStep } from '../../domain/setup/types.js';
import { noAnswerAction, verifyAction } from '../preparation.js';
import { commandTrustHandoff, isTrustRequired } from '../safety/trust.js';
import type { Tally } from '../tally.js';
import type { WorkspaceDeps } from '../workspace/deps.js';
import { workspaceCommand, type WorkspaceGuidance } from '../workspace/guidance.js';

import { buildPlan } from './collect.js';
import type { LoginDeps } from './deps.js';
import { handoffStep, loginCommand } from './handoff.js';
import { Verifier } from './verify.js';

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
  const progress = new SetupProgress();
  const check = async (step: SetupStep): Promise<Finding> => {
    const fix = loginCommand([step], deps);
    const standing = progress.admit(step);
    if (standing.kind !== 'clear') return blockedFinding(step, standing, deps);
    try {
      const verdict = await verifier.verify(
        step,
        options.dryRun === undefined ? {} : { dryRun: options.dryRun },
      );
      progress.record(step, verdict.ok ? 'done' : 'undone');
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
      const untrusted = isTrustRequired(err);
      progress.record(step, untrusted ? 'undone' : 'unanswered');
      return untrusted ? trustFinding(step, err, deps) : unfinishedFinding(step, err, deps);
    }
  };
  checks.plan(plan.steps.length);
  for (const step of plan.steps) findings.push(await checks.unit(step.id, () => check(step)));
  return findings;
}

function trustFinding(step: SetupStep, error: DevkitError, deps: WorkspaceDeps): Finding {
  const handoff = commandTrustHandoff(deps.trust, step.tool);
  return finding('login', step.id, 'warn', error.message, {
    coverage: 'incomplete',
    fix: handoff.command,
    handoff,
    actions: [verifyAction(deps, step.tool)],
  });
}

// The tool is what to fix when it did not start; otherwise the check is asked again.
function unfinishedFinding(step: SetupStep, error: DevkitError, deps: WorkspaceDeps): Finding {
  const recovery = error.code === 'TOOL_MISSING' ? ['tool', 'install'] : ['doctor', '--tool'];
  return finding('login', step.id, 'warn', error.message, {
    fix: workspaceCommand(deps, ...recovery, step.tool),
    coverage: 'incomplete',
    actions: [noAnswerAction(deps, step, error.code)],
  });
}

function blockedFinding(step: SetupStep, held: HeldBack, deps: WorkspaceGuidance): Finding {
  return finding('login', step.id, 'warn', `Blocked by ${held.by}`, {
    coverage: 'incomplete',
    ...(held.kind === 'unanswered'
      ? { fix: workspaceCommand(deps, 'doctor', '--tool', step.tool), actions: [] }
      : { fix: loginCommand([step], deps) }),
  });
}
