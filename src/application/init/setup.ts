// Initialization performs local preparation; synchronization only verifies it.
// Personal sign-in and operator-owned files always remain explicit handoffs.
import path from 'node:path';

import { preparationCheck, type PreparationAction } from '../../domain/preparation.js';
import type { SetupPlan, SetupStep } from '../../domain/setup/types.js';
import { checkLogin } from '../doctor/login.js';
import type { LoginDeps } from '../login/deps.js';
import { Login } from '../login/run.js';
import { expandHome } from '../login/verify.js';
import { findingCheck, resumeAction, verifyAction } from '../preparation.js';
import type { WritePosture } from '../safety/posture.js';
import type { StageResult } from '../sync/types.js';
import { Tally } from '../tally.js';
import { workspaceToolScope, type WorkspaceToolScope } from '../tool/scope.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

export async function prepareWorkspaceSetup(
  deps: WorkspaceDeps,
  login: LoginDeps,
  input: {
    readonly apply: boolean;
    readonly dryRun: boolean;
    readonly posture: WritePosture;
  },
): Promise<StageResult> {
  const scope = workspaceToolScope(deps.ctx, {});
  const useCase = new Login(deps, login);
  const plan = await useCase.plan({ tools: scope.configuredNames });
  if (!input.apply) return verifyWorkspaceSetup(deps, login, scope, plan);
  const output = await useCase.execute({
    tools: scope.configuredNames,
    mode: 'prepare',
    skipManual: false,
    dryRun: input.dryRun,
    noInput: true,
    posture: input.posture,
  });
  return {
    summary: output.summary,
    details: { items: output.items, problems: output.problems },
    checks: [
      ...output.items.map((item) => {
        const step = plan.steps.find((step) => step.id === item.id)!;
        const ready = item.result === 'verified' || item.result === 'done';
        const detail = `${item.title}: ${item.detail ?? item.result}${!ready && 'file' in step.verify ? `; expected ${path.resolve(deps.ctx.root, expandHome(step.verify.file, login.home))}` : ''}`;
        return preparationCheck(`login:${item.id}`, ready ? 'ready' : 'blocked', detail, {
          resource: item.id,
          required: scope.required.has(item.tool),
          owner: step.phase === 'prepare' ? 'agent' : 'user',
          ...(ready
            ? {}
            : {
                actions:
                  item.actions ??
                  (step.phase !== 'prepare' && item.failure?.code === 'VECTOR_UNTRUSTED'
                    ? [verifyAction(deps, step.tool)]
                    : setupActions(deps, step, login.home, true)),
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

async function verifyWorkspaceSetup(
  deps: WorkspaceDeps,
  login: LoginDeps,
  scope: WorkspaceToolScope,
  plan: SetupPlan,
): Promise<StageResult> {
  const findings = await Tally.during(deps.activity, 'setup', (checks) =>
    checkLogin(
      deps,
      login,
      { tools: scope.configuredNames, requiredTools: scope.required, dryRun: true },
      checks,
    ),
  );
  return {
    summary: { checked: findings.length },
    details: { findings },
    checks: findings.map((finding) => {
      const step = plan.steps.find((step) => step.id === finding.id);
      return {
        ...findingCheck(finding, step ? scope.required.has(step.tool) : true),
        ...(step && finding.level !== 'ok' && !finding.actions
          ? { actions: setupActions(deps, step, login.home) }
          : {}),
      };
    }),
  };
}

export function setupActions(
  deps: WorkspaceDeps,
  step: SetupStep,
  home: string,
  initializing = false,
): PreparationAction[] {
  if (step.phase === 'prepare')
    return [
      {
        ...resumeAction(deps),
        id: `approve:${step.id}`,
        description: initializing
          ? 'Review the remaining initialization effects and continue this workspace'
          : `Repair ${step.tool}'s local preparation and the workspace's managed guides and Skills`,
        argv: initializing
          ? [...resumeAction(deps).argv, '--yes']
          : ['fx', 'doctor', '--fix', '--tool', step.tool, '--workspace', deps.ctx.name, '--yes'],
        requires_approval: true,
      },
    ];
  return [
    {
      actor: 'user',
      id: `login:${step.id}`,
      description: `${step.instructions ?? step.title}${'file' in step.verify ? ` Expected file: ${path.resolve(deps.ctx.root, expandHome(step.verify.file, home))}.` : ''}`,
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
