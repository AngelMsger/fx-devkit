// Explicit setup runs only public preparation, never login or credential acquisition.
import { buildPlan } from '../login/collect.js';
import type { LoginDeps } from '../login/deps.js';
import type { StageResult } from '../sync.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import { ServiceOperation } from './operation.js';
import type { ServiceResult } from './types.js';

export async function prepareServices(
  deps: WorkspaceDeps,
  login: LoginDeps,
  dryRun: boolean,
): Promise<StageResult> {
  const plan = buildPlan(deps, login, { scopeEnvs: deps.ctx.local.scope?.envs });
  const problems = plan.problems.filter((problem) => /\.service(?:@|$)/.test(problem.step));
  const operation = new ServiceOperation(deps, login);
  const items: ServiceResult[] = [];
  for (const step of plan.steps.filter((step) => step.preparation))
    items.push(await operation.execute(step, dryRun));
  const summary = Object.fromEntries(
    ['unchanged', 'configured', 'planned', 'blocked', 'failed'].map((status) => [
      status,
      items.filter((item) => item.status === status).length,
    ]),
  );
  return {
    summary: { ...summary, problems: problems.length },
    details: { items, problems },
  };
}
