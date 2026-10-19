// Native dry-run is the source of merge/conflict decisions. Never retry with overwrite.
import type { SetupStep } from '../../domain/setup/types.js';
import { shellLine } from '../../domain/shell.js';
import type { ProcessResult } from '../../ports/process.js';
import type { ServiceFailure, ServicePlan } from '../../ports/service-protocol.js';
import type { LoginDeps } from '../login/deps.js';
import { assertWritable } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import type { ServiceOutcome } from './types.js';

interface Preset {
  readonly deps: WorkspaceDeps;
  readonly login: LoginDeps;
  readonly step: SetupStep;
  readonly dryRun: boolean;
}

export async function prepareCommand(
  deps: WorkspaceDeps,
  login: LoginDeps,
  step: SetupStep,
  dryRun: boolean,
): Promise<ServiceOutcome> {
  const preset: Preset = { deps, login, step, dryRun };
  const create = step.run ?? [];
  const settle =
    step.preparation?.kind === 'command' ? [create[0] ?? '', ...step.preparation.agrees] : create;
  const serving = await consult(preset, settle);
  if ('status' in serving) return serving;
  // Only creation may apply the declared authentication method.
  const creating = serving.createsContext;
  const vector = creating ? create : settle;
  const plan = creating ? await consult(preset, create) : serving;
  if ('status' in plan) return plan;
  const changes = plan.changes;
  if (dryRun)
    return { status: 'planned', detail: 'Public service settings would be prepared', changes };
  assertWritable(deps.trust.posture, step.id);
  await deps.trust.gate.ensure(trustOf(preset, vector, step.id));
  const applied = await runPreset(preset, vector, 'prepare');
  if (applied.code !== 0)
    return commandFailure(login.serviceProtocol.failure(applied.stderr), vector, deps);
  const after = await runPreset(preset, [...settle, '--dry-run'], 'verify');
  return verified(
    after.code === 0 && login.serviceProtocol.plan(after.stdout).kind === 'unchanged',
    changes,
  );
}

async function consult(
  preset: Preset,
  vector: readonly string[],
): Promise<ServiceOutcome | Extract<ServicePlan, { kind: 'changes' }>> {
  const { deps, login } = preset;
  const preview = [...vector, '--dry-run'];
  if (preset.dryRun && !(await deps.trust.gate.isTrusted(trustOf(preset, preview))))
    return {
      status: 'blocked',
      detail: 'Service preview command is not trusted',
      next_steps: [shellLine(preview, deps.commandShell)],
    };
  await deps.trust.gate.ensure(trustOf(preset, preview));
  const result = await runPreset(preset, preview, 'preview');
  if (result.code !== 0)
    return commandFailure(login.serviceProtocol.failure(result.stderr), vector, deps);
  const plan = login.serviceProtocol.plan(result.stdout);
  if (plan.kind === 'unchanged')
    return { status: 'unchanged', detail: 'Public service settings match' };
  if (plan.kind === 'unreadable')
    return { status: 'failed', detail: 'Companion did not return a service configuration plan' };
  return plan;
}

function trustOf(preset: Preset, vector: readonly string[], label?: string) {
  return {
    ...preset.deps.trust,
    vector,
    origin: preset.step.origin,
    label: label ?? `${preset.step.id} preview`,
  };
}

function runPreset(
  preset: Preset,
  vector: readonly string[],
  phase: string,
): Promise<ProcessResult> {
  return preset.deps.process.run(vector, {
    timeoutMs: 5000,
    cwd: preset.deps.ctx.root,
    diagnostic: { phase: `${preset.step.id} ${phase}` },
  });
}

function verified(unchanged: boolean, changes: ServiceOutcome['changes']): ServiceOutcome {
  if (!unchanged)
    return { status: 'failed', detail: 'Service settings were not verified after preparation' };
  return {
    status: 'configured',
    detail: 'Public service settings prepared; personal login is separate',
    ...(changes ? { changes } : {}),
  };
}

function commandFailure(
  failure: ServiceFailure,
  vector: readonly string[],
  deps: WorkspaceDeps,
): ServiceOutcome {
  return {
    status: 'blocked',
    detail: failure.code ?? 'Companion service preparation failed',
    changes: failure.changes,
    next_steps:
      failure.kind === 'conflict'
        ? [
            shellLine([...vector, '--overwrite', '--dry-run'], deps.commandShell),
            `After reviewing the differences: ${shellLine([...vector, '--overwrite'], deps.commandShell)}`,
          ]
        : [
            failure.kind === 'managed_session'
              ? 'Declare a new context and complete personal browser login.'
              : 'Inspect the companion CLI configuration and retry.',
          ],
  };
}
