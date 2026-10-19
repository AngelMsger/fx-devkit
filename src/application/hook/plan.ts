// Plans one entry per selected host from its current file and ownership receipt.

import { handoffEnvelope, type HandoffEnvelope } from '../../domain/errors.js';
import type { HookAction } from '../../domain/harness/actions.js';
import { BUILTIN_HOOKS } from '../../domain/harness/hooks.js';
import type { HookReceipt, HookState } from '../../domain/harness/state.js';
import { samePath } from '../../domain/path.js';
import { fingerprint } from '../../domain/toolchain/trust.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { ProjectionSnapshot } from '../../ports/projection.js';
import { enabledHosts } from '../agent/list.js';

import type { HookDeps, HookPlan, PlannedHook, ReconcileInput } from './types.js';

export async function planHooks(deps: HookDeps, input: ReconcileInput): Promise<HookPlan> {
  const local = await deps.local.read(input.workspace);
  const state = await deps.state.read(input.workspace);
  let enabled = input.globalEnabled && local.hooks?.enabled !== false;
  if (input.action === 'inject') enabled = input.globalEnabled;
  if (input.action === 'remove') enabled = false;
  const selected = await enabledHosts(deps.hosts, input.configured);
  const owned = ownedReceipts(input, state);
  const plans: PlannedHook[] = [];
  for (const host of deps.hosts) {
    const receipt = owned.find((r) => r.agent === host.id);
    plans.push(await planHost(deps, input, host, receipt, enabled && selected.includes(host)));
  }
  return { workspace: input.workspace, root: input.root, plans, enabled, state };
}

// Recorded receipts prove ownership only while they still describe the root
// being reconciled; against any other root the workspace owns nothing.
export function ownedReceipts(
  input: ReconcileInput,
  state: HookState | null,
): readonly HookReceipt[] {
  if (state === null || !samePath(state.root, input.ownershipRoot ?? input.root)) return [];
  return state.receipts;
}

async function planHost(
  deps: HookDeps,
  input: ReconcileInput,
  host: AgentHost,
  receipt: HookReceipt | undefined,
  enabled: boolean,
): Promise<PlannedHook> {
  const support = host.hooks;
  const base = basePlan(host);
  if (!support) return base;
  const remove = input.action === 'remove' || input.removeAgents?.includes(host.id) === true;
  if (!enabled && !remove)
    return {
      ...base,
      row: { ...base.row, action: 'disabled', activation: 'disabled', handoff: null },
    };
  if (input.removeAgents && !remove)
    return { ...base, row: { ...base.row, action: 'unchanged', handoff: null } };
  const before = await deps.files.read({ root: input.root, relative: support.projectPath });
  if (before.kind === 'foreign')
    return {
      ...base,
      row: {
        ...base.row,
        action: 'foreign',
        command: 'fx hook list',
        handoff: hookHandoff(
          'Inspect the foreign path; fx left its contents unchanged',
          'fx hook list',
        ),
      },
    };
  const owner =
    remove && receipt
      ? receipt.owner
      : `fx:${fingerprint([input.workspace, input.root, host.id, 'session-start']).slice(0, 24)}`;
  const projected = deps.protocol(support).project({
    current: before.text,
    owner,
    event: support.events['session-start']!,
    vector: hookVector(deps, input, host),
    remove,
  });
  if (projected.status !== 'managed')
    return {
      ...base,
      row: {
        ...base.row,
        action: projected.status,
        command: 'fx hook list',
        handoff: hookHandoff(
          'Repair the reported configuration path while preserving user entries, then retry',
          'fx hook enable',
        ),
      },
    };
  let text = projected.text;
  if (remove && receipt?.created && projected.empty) text = null;
  return managedPlan({ base, before, text, receipt, owner, remove });
}

function managedPlan(input: {
  readonly base: PlannedHook;
  readonly before: ProjectionSnapshot;
  readonly text: string | null;
  readonly receipt: HookReceipt | undefined;
  readonly owner: string;
  readonly remove: boolean;
}): PlannedHook {
  const { base, before, text, receipt, owner, remove } = input;
  if (base.row.path === null) return base;
  const action = projectionAction(remove, before, text);
  return {
    before,
    text,
    receipt: {
      agent: base.row.agent,
      relative: base.row.path,
      owner,
      created: receipt?.created ?? before.kind === 'absent',
    },
    row: {
      ...base.row,
      action,
      activation: remove ? 'disabled' : base.row.activation,
      handoff: remove
        ? null
        : hookHandoff(
            base.row.handoff?.summary ??
              'The projection does not prove native activation; review project and hook trust in the host',
            'fx hook list',
          ),
    },
  };
}

function hookVector(deps: HookDeps, input: ReconcileInput, host: AgentHost): readonly string[] {
  return [
    ...deps.executable,
    ...BUILTIN_HOOKS[0]!.command.slice(1),
    '--workspace',
    input.workspace,
    '--root',
    input.root,
    '--fx-home',
    deps.home,
    '--agent',
    host.id,
  ];
}

function projectionAction(
  remove: boolean,
  before: ProjectionSnapshot,
  text: string | null,
): HookAction {
  if (remove) return 'remove';
  if (before.text === text) return 'unchanged';
  return before.kind === 'absent' ? 'create' : 'update';
}

function hookHandoff(summary: string, command: string): HandoffEnvelope {
  return handoffEnvelope({
    summary,
    userSteps: [
      {
        id: 'hooks',
        kind: 'manual',
        title: summary,
        instructions:
          'Use the indicated fx command. Host project trust must be reviewed in the host; fx never approves it automatically.',
      },
    ],
    command,
  });
}

function basePlan(host: AgentHost): PlannedHook {
  const support = host.hooks;
  return {
    row: {
      activation:
        support === null || support.activationLimit !== undefined ? 'unsupported' : 'unverified',
      handoff: hookHandoff(
        support?.activationLimit ??
          (support === null
            ? 'Lifecycle support is unavailable for this host'
            : 'The projection does not prove native activation; review project and hook trust in the host'),
        'fx sync --only docs,skills',
      ),
      agent: host.id,
      path: support?.projectPath ?? null,
      context: support?.context ?? null,
      action: 'unsupported',
      command: null,
    },
    receipt: null,
    before: { kind: 'absent', text: null },
    text: null,
  };
}
