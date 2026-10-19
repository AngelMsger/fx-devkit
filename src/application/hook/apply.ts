// Writes planned entries under the caller's hooks lease and records what survived.

import { hookActionState } from '../../domain/harness/actions.js';
import type { HookReceipt, HookState } from '../../domain/harness/state.js';
import { isLostWrite } from '../../domain/projection.js';

import { ownedReceipts } from './plan.js';
import type { HookDeps, HookOutput, HookPlan, HookRow, ReconcileInput } from './types.js';

export async function applyHookPlan(
  deps: HookDeps,
  input: ReconcileInput,
  plan: HookPlan,
): Promise<HookOutput> {
  const receipts = [...ownedReceipts(input, plan.state)];
  const items: HookRow[] = [];
  for (const item of plan.plans) {
    if (!item.receipt) {
      items.push(item.row);
      continue;
    }
    const result = await deps.files.write({
      root: input.root,
      relative: item.receipt.relative,
      before: item.before,
      text: item.text,
    });
    items.push({
      ...item.row,
      ...(isLostWrite(result) ? { action: result } : {}),
    });
    if (isLostWrite(result)) continue;
    const at = receipts.findIndex((r) => r.agent === item.receipt!.agent);
    if (at >= 0) receipts.splice(at, 1);
    if (item.row.action !== 'remove') receipts.push(item.receipt);
    // Persist each completed projection before the next IO can fail. Preferences
    // commit only after all projections and receipts have succeeded.
    await deps.state.write(input.workspace, stateOf(input, plan, receipts));
  }
  const state = stateOf(input, plan, receipts);
  await deps.state.write(input.workspace, state);
  await commitPreference(deps, input, items);
  const local = await deps.local.read(input.workspace);
  return {
    workspace: input.workspace,
    root: input.root,
    items,
    enabled: input.globalEnabled && local.hooks?.enabled !== false,
    state,
  };
}

function stateOf(
  input: ReconcileInput,
  plan: HookPlan,
  receipts: readonly HookReceipt[],
): HookState {
  return {
    root: input.root,
    receipts: [...receipts],
    lastAttempt: plan.state?.lastAttempt ?? null,
    lastRefresh: plan.state?.lastRefresh ?? null,
    observations: plan.state?.observations ?? [],
  };
}

async function commitPreference(
  deps: HookDeps,
  input: ReconcileInput,
  items: readonly HookRow[],
): Promise<void> {
  const complete = items.every((item) => hookActionState(item.action) !== 'blocked');
  if (complete && (input.action === 'inject' || input.action === 'remove')) {
    await deps.local.update(input.workspace, (local) => ({
      ...local,
      hooks: { enabled: input.action === 'inject' },
    }));
  }
}
