// Plans resource edits from declarations and current ownership evidence.

import { referencedVariables } from '../../domain/harness/mcp.js';
import type { HarnessReceipt, HarnessState } from '../../domain/harness/ownership.js';
import type { RulesProjectionResult } from '../../domain/harness/rules.js';
import { snapshotDigest } from '../../domain/harness/state-recovery.js';
import type { McpResource } from '../../domain/manifest/types.js';
import type { McpProjectionResult } from '../../ports/mcp-codec.js';
import type { ProjectionSnapshot } from '../../ports/projection.js';
import type { TrustInput } from '../safety/trust.js';

import { harnessTargets, harnessHandoff } from './targets.js';
import type {
  HarnessDeps,
  HarnessInput,
  HarnessPlan,
  HarnessTarget,
  HarnessRow,
  HarnessChange,
} from './types.js';

export async function planHarness(
  deps: HarnessDeps,
  input: HarnessInput,
  state: HarnessState,
): Promise<HarnessPlan> {
  const { targets, rows } = harnessTargets(deps, input, state);
  const changes: HarnessChange[] = [];
  const trusts: TrustInput[] = [];
  const snapshots = new Map<string, ProjectionSnapshot>();
  for (const target of targets) {
    const before =
      snapshots.get(target.relative) ??
      (await deps.files.read({ root: input.root, relative: target.relative }));
    const planned = await planTarget(deps, input, state, target, before);
    rows.push(planned.row);
    if (planned.change) {
      changes.push(planned.change);
      snapshots.set(target.relative, {
        kind: planned.change.text === null ? 'absent' : 'file',
        text: planned.change.text,
      });
    }
    trusts.push(...planned.trusts);
  }
  return { items: rows, changes, trusts, state };
}
async function planTarget(
  deps: HarnessDeps,
  input: HarnessInput,
  state: HarnessState,
  target: HarnessTarget,
  before: ProjectionSnapshot,
) {
  const receipt = state.receipts.find((item) => item.key === target.key);
  const row: HarnessRow = {
    key: target.key,
    kind: target.kind,
    name: target.name,
    agents: target.agents,
    path: target.relative,
    action: 'unchanged',
    variables: target.resource ? referencedVariables(target.resource) : [],
    handoff: null,
  };
  const blocked = (action: string, message: string) => ({
    row: { ...row, action, handoff: harnessHandoff(message) },
    change: null,
    trusts: [],
  });
  // Ownership decides first: a path fx will not write is no reason to ask a person
  // for variables or to name a protocol it does not have.
  if (before.kind === 'foreign')
    return blocked('foreign', 'The native configuration path is foreign.');
  if (target.resource) {
    const missing = row.variables.filter((name) => !deps.env[name]);
    if (missing.length)
      return blocked(
        'missing_variables',
        missing
          .map(
            (name) =>
              `${name}: ${target.resource?.variables?.[name]?.instructions ?? 'Obtain this variable in the host environment.'}`,
          )
          .join('\n'),
      );
  }
  if (target.kind === 'mcp' && !target.support)
    return blocked(
      'unsupported',
      'The previous native descriptor is unavailable; preserve this configuration.',
    );
  let projected = projectTarget(deps, target, before, receipt);
  if (!projected) return blocked('unsupported', 'The native protocol is unavailable.');
  if (projected.status !== 'managed')
    return blocked(
      projected.status,
      'Native content changed or has no matching ownership evidence.',
    );
  // A cleanup pass owns only what it removes; a target that stays keeps its bytes.
  if (input.cleanupAgents && !target.remove && receipt)
    projected = { status: 'managed', text: before.text, digest: receipt.digest };
  return finishTarget({ deps, input, target, before, receipt, row, projected });
}
function projectTarget(
  deps: HarnessDeps,
  target: HarnessTarget,
  before: ProjectionSnapshot,
  receipt: HarnessReceipt | undefined,
) {
  return target.kind === 'rules'
    ? deps.rules?.(target.protocol)?.({ current: before.text, remove: target.remove })
    : deps.codec(target.protocol)?.project({
        current: before.text,
        support: target.support!,
        name: target.name,
        resource: target.resource,
        owned: receipt?.digest ?? null,
      });
}
interface TargetResultInput {
  readonly deps: HarnessDeps;
  readonly input: HarnessInput;
  readonly target: HarnessTarget;
  readonly before: ProjectionSnapshot;
  readonly receipt: HarnessReceipt | undefined;
  readonly row: HarnessRow;
  readonly projected: McpProjectionResult | RulesProjectionResult;
}
async function finishTarget({
  deps,
  input,
  target,
  before,
  receipt,
  row,
  projected,
}: TargetResultInput) {
  const digest =
    'digest' in projected
      ? projected.digest
      : snapshotDigest({ kind: 'file', text: projected.text });
  const next = target.remove
    ? null
    : {
        key: target.key,
        kind: target.kind,
        relative: target.relative,
        protocol: target.protocol,
        name: target.name,
        agents: target.agents,
        digest: digest!,
        created: receipt?.created ?? before.kind === 'absent',
      };
  const change =
    before.text !== projected.text || JSON.stringify(receipt ?? null) !== JSON.stringify(next)
      ? { key: target.key, relative: target.relative, before, text: projected.text, receipt: next }
      : null;
  const required = target.resource
    ? [
        mcpTrust(input, target.resource),
        ...(target.resource.check ? [mcpCheckTrust(input, target.resource)] : []),
      ]
    : [];
  const trusts: TrustInput[] = [];
  for (const request of required) if (!(await deps.trust.isTrusted(request))) trusts.push(request);
  const trusted = trusts.length === 0;
  let action = 'unchanged';
  if (change) action = receipt === undefined ? 'created' : 'updated';
  if (change && target.remove) action = 'removed';
  // Last, so it wins: an unapproved vector is what the row has to say, whatever the
  // change would otherwise have been called.
  if (!trusted) action = 'untrusted';
  return {
    row: {
      ...row,
      action,
      handoff: trusted
        ? null
        : harnessHandoff(
            'Review the MCP startup vector and environment references before projection.',
          ),
    },
    change,
    trusts,
  };
}
export function mcpTrust(
  input: Pick<HarnessInput, 'workspace' | 'posture' | 'yes'>,
  resource: McpResource,
): TrustInput {
  return {
    ...input,
    vector: resource.command ?? [],
    label: `MCP ${resource.name}`,
    origin: 'patch',
    execution: {
      purpose: `mcp-${resource.transport}`,
      resource: JSON.stringify([resource.name, resource.url ?? null]),
      bindings: Object.fromEntries([
        ...Object.entries(resource.env ?? {}).map(([key, ref]) => [`env.${key}`, ref.from_env]),
        ...Object.entries(resource.headers ?? {}).map(([key, ref]) => [
          `header.${key}`,
          ref.from_env,
        ]),
      ]),
    },
  };
}

export function mcpCheckTrust(
  input: Pick<HarnessInput, 'workspace' | 'posture' | 'yes'>,
  resource: McpResource,
): TrustInput {
  const base = mcpTrust(input, resource);
  return {
    ...base,
    vector: resource.check?.command ?? [],
    label: `MCP ${resource.name} check`,
    execution: { ...base.execution!, purpose: 'mcp-check' },
  };
}
