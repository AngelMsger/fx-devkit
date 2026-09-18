// The read-only view of a plan: what inspect and dry-run report.

import type { HookOutput, HookPlan } from './types.js';

export function hookOutput(plan: HookPlan): HookOutput {
  return {
    workspace: plan.workspace,
    root: plan.root,
    items: plan.plans.map((p) => p.row),
    enabled: plan.enabled,
    state: plan.state,
  };
}
