// Explicit setup runs only public preparation, never login or credential acquisition.
import { preparationCheck } from '../../domain/preparation.js';
import { problemsOfRecipe, SERVICE_RECIPE_ID } from '../../domain/setup/names.js';
import { buildPlan } from '../login/collect.js';
import type { LoginDeps } from '../login/deps.js';
import type { ServiceStageDetails, StageResult } from '../sync/types.js';
import { workspaceToolScope } from '../tool/scope.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { ServiceOperation } from './operation.js';
import { SERVICE_STATUSES, type ServiceResult } from './types.js';

export async function prepareServices(
  deps: WorkspaceDeps,
  login: LoginDeps,
  options: { readonly dryRun: boolean },
): Promise<StageResult<ServiceStageDetails>> {
  const plan = buildPlan(deps, login, { scopeEnvs: deps.ctx.local.scope?.envs });
  const problems = problemsOfRecipe(plan.problems, SERVICE_RECIPE_ID);
  const operation = new ServiceOperation(deps, login);
  const items: ServiceResult[] = [];
  for (const step of plan.steps.filter((step) => step.preparation))
    items.push(await operation.execute(step, options));
  const summary = Object.fromEntries(
    SERVICE_STATUSES.map((status) => [
      status,
      items.filter((item) => item.status === status).length,
    ]),
  );
  return {
    checks: [
      ...items.map((item) =>
        preparationCheck(
          `service:${item.id}`,
          item.status === 'failed' || item.status === 'blocked' ? 'blocked' : 'ready',
          item.detail,
          {
            resource: item.id,
            required: workspaceToolScope(deps.ctx, {}).required.has(item.tool),
            owner: 'user',
            ...(item.failure ? { failure: item.failure, code: item.failure.code } : {}),
            ...(item.actions ? { actions: item.actions } : {}),
          },
        ),
      ),
      ...problems.map((problem) =>
        preparationCheck(problem.step, 'blocked', problem.detail, { owner: 'maintainer' }),
      ),
    ],
    summary: { ...summary, problems: problems.length },
    details: { items, problems },
  };
}
