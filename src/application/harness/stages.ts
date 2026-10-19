// Connects harness projection and readiness to sync and doctor.

import { asDevkitError, DevkitError } from '../../domain/errors.js';
import { harnessActionState } from '../../domain/harness/actions.js';
import type { HarnessKind } from '../../domain/harness/ownership.js';
import { preparationCheck } from '../../domain/preparation.js';
import { finding } from '../../domain/report.js';
import { countBy } from '../../domain/values.js';
import type { Lease } from '../../ports/lock.js';
import type { DoctorExtension } from '../doctor/types.js';
import type { StageResult } from '../sync/types.js';

import { McpReadinessBatch } from './mcp-readiness-batch.js';
import { ReconcileHarness } from './reconcile.js';
import { loadHarnessCommand, type HarnessSession } from './session.js';
import type { HarnessInput, HarnessOutput } from './types.js';

export interface ManageHarness extends HarnessSession {
  readonly action: HarnessInput['action'];
  readonly dryRun: boolean;
  readonly only?: HarnessInput['only'];
  readonly workspaceLease?:
    | {
        readonly workspace: string;
        readonly root: string;
        readonly lease: Lease;
      }
    | undefined;
}
export async function manageHarness(command: ManageHarness): Promise<HarnessOutput> {
  const { deps, input } = await loadHarnessCommand(command);
  const held = command.workspaceLease;
  if (held && (held.workspace !== input.workspace || held.root !== input.root))
    throw new DevkitError('conflict', 'HARNESS_PLAN_CHANGED', 'Workspace lease scope changed', {
      nextSteps: ['Retry workspace synchronization.'],
    });
  const lock = held
    ? {
        acquire: async (request: { key: string; waitMs: number }) =>
          request.key === `workspace:${input.workspace}`
            ? { release: async () => {} }
            : deps.lock.acquire(request),
      }
    : deps.lock;
  return new ReconcileHarness({ ...deps, lock }).execute({
    ...input,
    action: command.action,
    dryRun: command.dryRun,
    only: command.only,
  });
}
export function harnessStage(command: ManageHarness): () => Promise<StageResult> {
  return async () => {
    const result = await manageHarness(command);
    const summary = countBy(result.items, (row) => row.action);
    for (const row of result.items)
      if (row.handoff)
        command.resolve.reporter.notice({
          code: 'HARNESS_NOT_READY',
          message: `${row.name}: ${row.action}`,
          nextSteps: ['fx doctor'],
          data: { handoff: row.handoff },
        });
    const checks = result.items.map((row) =>
      preparationCheck(
        `harness:${row.key}`,
        harnessActionState(row.action),
        `${row.name}: ${row.action}`,
        { resource: row.name, required: row.kind === 'rules', owner: 'user' },
      ),
    );
    const activation = result.items
      .filter((row) => row.kind === 'mcp' && harnessActionState(row.action) !== 'skipped')
      .map((row) =>
        preparationCheck(
          `activation:${row.key}`,
          'unknown',
          `${row.name}: native activation is unverified`,
          { resource: row.name, required: false, owner: 'user' },
        ),
      );
    return {
      summary,
      details: { items: result.items },
      checks: [...checks, ...activation],
      operationChecks: checks.map((check) => ({ ...check, required: true })),
    };
  };
}
export function harnessDoctor(command: HarnessSession, kind: HarnessKind): DoctorExtension {
  return {
    group: kind,
    check: () => checkHarness(command, kind),
    fix: async (options) => {
      await manageHarness({ ...command, action: 'sync', only: kind, dryRun: options.dryRun });
    },
  };
}

async function checkHarness(command: HarnessSession, kind: HarnessKind) {
  try {
    const { deps, input } = await loadHarnessCommand(command);
    const output = await new ReconcileHarness(deps).execute({ ...input, only: kind });
    const findings = output.items.map((row) =>
      finding(
        kind,
        row.key,
        row.action === 'unchanged' ? 'ok' : 'warn',
        `${row.name}: ${row.action}; native activation unverified`,
        {
          handoff: row.handoff ?? undefined,
          ...(row.action === 'unchanged' ? {} : { fix: 'fx sync --only mcp,docs' }),
        },
      ),
    );
    if (kind === 'mcp') findings.push(...(await readinessFindings(command, { deps, input })));
    return findings;
  } catch (err) {
    // Doctor answers for every group, so an inspection that threw is an unanswered
    // check rather than a failed one; see Coverage in domain/report.ts.
    return [
      finding(kind, 'inspection', 'warn', `Harness inspection failed: ${asDevkitError(err).code}`, {
        fix: 'fx manifest validate --kind harness',
        coverage: 'incomplete',
      }),
    ];
  }
}

async function readinessFindings(
  command: HarnessSession,
  loaded: Awaited<ReturnType<typeof loadHarnessCommand>>,
) {
  const { deps, input } = loaded;
  const results = await new McpReadinessBatch({
    process: command.process,
    trust: deps.trust,
    env: command.env,
  }).execute({
    workspace: input.workspace,
    resources: input.harness?.mcp ?? [],
    posture: command.posture,
  });
  return results.map((result) =>
    finding(
      'mcp',
      `ready:${result.resource}`,
      result.status === 'ready' ? 'ok' : 'warn',
      `${result.resource}: ${result.status} (${result.evidence})`,
      {
        handoff: result.handoff ?? undefined,
        coverage: result.status === 'unknown' ? 'incomplete' : 'checked',
      },
    ),
  );
}
