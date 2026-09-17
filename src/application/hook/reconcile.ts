// Hook management plans every selected host before writing. Workspace leases
// serialize preferences and receipts; each file is rechecked by its projection
// store. Inspect and dry-run never create leases or change personal settings.

import { DevkitError, handoffEnvelope, type HandoffEnvelope } from '../../domain/errors.js';
import { BUILTIN_HOOKS, type HookSupport } from '../../domain/harness/hooks.js';
import type { HookReceipt, HookState } from '../../domain/harness/state.js';
import { samePath } from '../../domain/path.js';
import { fingerprint } from '../../domain/toolchain/trust.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { HookProtocol } from '../../ports/hook-protocol.js';
import type { HookStateStore } from '../../ports/hook-state.js';
import type { Lock } from '../../ports/lock.js';
import type { ProjectionSnapshot, ProjectionStore } from '../../ports/projection.js';
import type { LocalLayerStore } from '../../ports/stores.js';
import { enabledHosts } from '../agent/list.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

export interface HookDeps {
  readonly hosts: readonly AgentHost[];
  readonly local: LocalLayerStore;
  readonly state: HookStateStore;
  readonly lock: Lock;
  readonly files: ProjectionStore;
  readonly protocol: (support: HookSupport) => HookProtocol;
  readonly executable: readonly string[];
  readonly home: string;
}

export interface ReconcileInput {
  readonly workspace: string;
  readonly root: string;
  readonly action: 'inspect' | 'inject' | 'remove' | 'sync';
  readonly globalEnabled: boolean;
  readonly configured: readonly string[] | undefined;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly removeAgents?: readonly string[];
}

export interface HookRow {
  readonly activation: 'unverified' | 'unsupported' | 'disabled';
  readonly handoff: HandoffEnvelope | null;
  readonly agent: string;
  readonly path: string | null;
  readonly context: HookSupport['context'] | null;
  readonly action: string;
  readonly command: string | null;
}

export interface HookOutput {
  readonly workspace: string;
  readonly root: string;
  readonly items: readonly HookRow[];
  readonly enabled: boolean;
  readonly state: HookState | null;
}

interface Planned {
  readonly row: HookRow;
  readonly receipt: HookReceipt | null;
  readonly before: ProjectionSnapshot;
  readonly text: string | null;
}

export class ReconcileHooks {
  constructor(private readonly deps: HookDeps) {}

  async execute(input: ReconcileInput): Promise<HookOutput> {
    const preview = await this.plan(input);
    if (input.action === 'inspect' || input.dryRun) return output(preview);
    if (input.action === 'inject' && !input.globalEnabled)
      throw new DevkitError('config', 'HOOKS_DISABLED', 'Hooks are disabled globally', {
        hint: 'The workspace preference cannot override the global switch.',
        nextSteps: ['fx config get hooks --explain'],
      });
    if (input.action === 'sync' && !preview.enabled && !input.removeAgents) return output(preview);
    if (
      input.action === 'sync' &&
      !input.removeAgents &&
      preview.plans.every((p) => p.before.text === p.text) &&
      preview.state !== null
    )
      return output(preview);
    assertWritable(input.posture, 'manage workspace hooks');
    const lease = await this.deps.lock.acquire({ key: `hooks:${input.workspace}`, waitMs: 2000 });
    if (!lease)
      throw new DevkitError('conflict', 'LOCK_BUSY', 'Workspace hooks are being updated', {
        retryable: true,
        nextSteps: ['Retry shortly.'],
      });
    try {
      return await this.apply(input, await this.plan(input));
    } finally {
      await lease.release();
    }
  }

  private async plan(input: ReconcileInput): Promise<{
    workspace: string;
    root: string;
    plans: Planned[];
    enabled: boolean;
    state: HookState | null;
  }> {
    const local = await this.deps.local.read(input.workspace);
    const state = await this.deps.state.read(input.workspace);
    let enabled = input.globalEnabled && local.hooks?.enabled !== false;
    if (input.action === 'inject') enabled = input.globalEnabled;
    if (input.action === 'remove') enabled = false;
    const selected = await enabledHosts(this.deps.hosts, input.configured);
    const plans: Planned[] = [];
    for (const host of this.deps.hosts) {
      const receipt =
        state !== null && samePath(state.root, input.root)
          ? state.receipts.find((r) => r.agent === host.id)
          : undefined;
      plans.push(
        await planHost(this.deps, input, host, receipt, enabled && selected.includes(host)),
      );
    }
    return { workspace: input.workspace, root: input.root, plans, enabled, state };
  }

  private async apply(
    input: ReconcileInput,
    plan: Awaited<ReturnType<ReconcileHooks['plan']>>,
  ): Promise<HookOutput> {
    const receipts = [
      ...(plan.state !== null && samePath(plan.state.root, input.root) ? plan.state.receipts : []),
    ];
    const items: HookRow[] = [];
    for (const item of plan.plans) {
      if (!item.receipt) {
        items.push(item.row);
        continue;
      }
      const result = await this.deps.files.write({
        root: input.root,
        relative: item.receipt.relative,
        before: item.before,
        text: item.text,
      });
      items.push({
        ...item.row,
        ...(result === 'busy' || result === 'conflict' ? { action: result } : {}),
      });
      if (result === 'busy' || result === 'conflict') continue;
      const at = receipts.findIndex((r) => r.agent === item.receipt!.agent);
      if (at >= 0) receipts.splice(at, 1);
      if (item.row.action !== 'remove') receipts.push(item.receipt);
      // Persist each completed projection before the next IO can fail. Preferences
      // commit only after all projections and receipts have succeeded.
      await this.deps.state.write(input.workspace, {
        root: input.root,
        receipts: [...receipts],
        lastAttempt: plan.state?.lastAttempt ?? null,
        lastRefresh: plan.state?.lastRefresh ?? null,
        observations: plan.state?.observations ?? [],
      });
    }
    const state: HookState = {
      root: input.root,
      receipts,
      lastAttempt: plan.state?.lastAttempt ?? null,
      lastRefresh: plan.state?.lastRefresh ?? null,
      observations: plan.state?.observations ?? [],
    };
    await this.deps.state.write(input.workspace, state);
    await this.commitPreference(input, items);
    const local = await this.deps.local.read(input.workspace);
    return {
      workspace: input.workspace,
      root: input.root,
      items,
      enabled: input.globalEnabled && local.hooks?.enabled !== false,
      state,
    };
  }
  private async commitPreference(input: ReconcileInput, items: readonly HookRow[]): Promise<void> {
    const complete = items.every(
      (item) => !['busy', 'conflict', 'foreign', 'invalid'].includes(item.action),
    );
    if (complete && (input.action === 'inject' || input.action === 'remove')) {
      await this.deps.local.update(input.workspace, (local) => ({
        ...local,
        hooks: { enabled: input.action === 'inject' },
      }));
    }
  }
}

async function planHost(
  deps: HookDeps,
  input: ReconcileInput,
  host: AgentHost,
  receipt: HookReceipt | undefined,
  enabled: boolean,
): Promise<Planned> {
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
  const owner = `fx:${fingerprint([input.workspace, input.root, host.id, 'session-start']).slice(0, 24)}`;
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
  readonly base: Planned;
  readonly before: ProjectionSnapshot;
  readonly text: string | null;
  readonly receipt: HookReceipt | undefined;
  readonly owner: string;
  readonly remove: boolean;
}): Planned {
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
): string {
  if (remove) return 'remove';
  if (before.text === text) return 'unchanged';
  return before.kind === 'absent' ? 'create' : 'update';
}

function output(plan: {
  workspace: string;
  root: string;
  plans: readonly Planned[];
  enabled: boolean;
  state: HookState | null;
}): HookOutput {
  return {
    workspace: plan.workspace,
    root: plan.root,
    items: plan.plans.map((p) => p.row),
    enabled: plan.enabled,
    state: plan.state,
  };
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

function basePlan(host: AgentHost): Planned {
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
