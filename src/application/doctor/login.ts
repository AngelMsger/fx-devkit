// The check is the truth: a step a person acknowledged still fails when its
// check does, and the finding says both.

import { DevkitError, handoffEnvelope, type HandoffEnvelope } from '../../domain/errors.js';
import type { SetupStep } from '../../domain/setup/types.js';
import { buildPlan } from '../login/collect.js';
import type { LoginDeps } from '../login/deps.js';
import { handoffStep, loginCommand } from '../login/handoff.js';
import { Verifier } from '../login/verify.js';
import { commandTrustHandoff, isTrustRequired } from '../safety/trust.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { finding, type Finding } from './types.js';

export interface LoginCheckOptions {
  readonly tools?: readonly string[] | undefined;
  readonly envs?: readonly string[] | undefined;
  readonly dryRun?: boolean;
}

export async function checkLogin(
  deps: WorkspaceDeps,
  login: LoginDeps,
  options: LoginCheckOptions,
): Promise<Finding[]> {
  const plan = buildPlan(deps, login, { ...options, scopeEnvs: deps.ctx.local.scope?.envs });
  const verifier = new Verifier(deps, login);
  const acknowledged = deps.ctx.local.setup ?? {};
  const findings: Finding[] = plan.problems.map((p) =>
    finding('login', p.step, 'warn', `${p.detail} (${p.reason})`, {
      fix: 'fx login --list',
      coverage: 'incomplete',
    }),
  );
  const pending = new Set<string>();
  for (const step of plan.steps) {
    const fix = loginCommand([step]);
    try {
      const blocker = step.requires.find((id) => pending.has(id));
      if (blocker) {
        pending.add(step.id);
        findings.push(blockedFinding(step, blocker));
        continue;
      }
      const verdict = await verifier.verify(
        step,
        options.dryRun === undefined ? {} : { dryRun: options.dryRun },
      );
      if (verdict.ok) {
        findings.push(finding('login', step.id, 'ok', verdict.detail));
        continue;
      }
      const when = acknowledged[step.id]?.acknowledged;
      pending.add(step.id);
      const message =
        when === undefined
          ? verdict.detail
          : `acknowledged on ${when} but the check fails: ${verdict.detail}`;
      findings.push(
        finding('login', step.id, when !== undefined || step.required ? 'fail' : 'warn', message, {
          fix,
          handoff: handoffFor(step, fix),
        }),
      );
    } catch (err) {
      pending.add(step.id);
      if (!(err instanceof DevkitError)) throw err;
      if (!isTrustRequired(err)) {
        findings.push(
          finding('login', step.id, 'warn', err.message, { fix, coverage: 'incomplete' }),
        );
        continue;
      }
      findings.push(trustFinding(step, login, err));
    }
  }
  return findings;
}

function handoffFor(step: SetupStep, command: string): HandoffEnvelope {
  return handoffEnvelope({ summary: step.title, userSteps: [handoffStep(step)], command });
}

function trustFinding(step: SetupStep, login: LoginDeps, error: DevkitError): Finding {
  const handoff = commandTrustHandoff({ tool: step.tool, posture: login.trust.posture });
  return finding('login', step.id, 'warn', error.message, {
    coverage: 'incomplete',
    fix: handoff.command,
    handoff,
  });
}

function blockedFinding(step: SetupStep, blocker: string): Finding {
  return finding('login', step.id, 'warn', `Blocked by ${blocker}`, {
    fix: loginCommand([step]),
    coverage: 'incomplete',
  });
}
