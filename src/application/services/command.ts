// Native dry-run is the source of merge/conflict decisions. Never retry with overwrite.
import type { SetupStep } from '../../domain/setup/types.js';
import { shellLine } from '../../domain/shell.js';
import { errorEnvelope } from '../../domain/toolchain/stderr.js';
import type { ProcessResult } from '../../ports/process.js';
import type { LoginDeps } from '../login/deps.js';
import { assertWritable } from '../safety/posture.js';
import type { WorkspaceDeps } from '../workspace/deps.js';

import type { ServiceOutcome } from './types.js';

function object(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

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
  // Where the service is, without how to sign in: a context that already serves the
  // declared service is ready as the person set it up.
  const settle =
    step.preparation?.kind === 'command' ? [create[0] ?? '', ...step.preparation.agrees] : create;
  const serving = await consult(preset, settle);
  if ('status' in serving) return serving;
  // The companion proposes a scheme only for a context that has none. That one is created
  // the way the declaration signs in; an existing one keeps its own and gains the rest.
  const creating = isRecord(serving.pending) && 'auth.scheme' in serving.pending;
  const vector = creating ? create : settle;
  const plan = creating ? await consult(preset, create) : serving;
  if ('status' in plan) return plan;
  const changes = publicChanges(plan.pending);
  if (dryRun)
    return { status: 'planned', detail: 'Public service settings would be prepared', changes };
  assertWritable(login.trust.posture, step.id);
  await login.trust.gate.ensure(trustOf(preset, vector, step.id));
  const applied = await runPreset(preset, vector, 'prepare');
  if (applied.code !== 0) return commandFailure(applied.stderr, vector, deps);
  return verified(await runPreset(preset, [...settle, '--dry-run'], 'verify'), changes);
}

// What a preset's dry run says: an outcome that ends the step, or the changes it would make.
async function consult(
  preset: Preset,
  vector: readonly string[],
): Promise<ServiceOutcome | { readonly pending: unknown }> {
  const { deps, login } = preset;
  const preview = [...vector, '--dry-run'];
  if (preset.dryRun && !(await login.trust.gate.isTrusted(trustOf(preset, preview))))
    return {
      status: 'blocked',
      detail: 'Service preview command is not trusted',
      next_steps: [shellLine(preview, deps.commandShell)],
    };
  await login.trust.gate.ensure(trustOf(preset, preview));
  const result = await runPreset(preset, preview, 'preview');
  if (result.code !== 0) return commandFailure(result.stderr, vector, deps);
  const data = object(result.stdout);
  if (data['changed'] === false)
    return { status: 'unchanged', detail: 'Public service settings match' };
  if (data['changed'] !== true)
    return { status: 'failed', detail: 'Companion did not return a service configuration plan' };
  return { pending: data['changes'] };
}

function trustOf(preset: Preset, vector: readonly string[], label?: string) {
  return {
    ...preset.login.trust,
    workspace: preset.deps.ctx.name,
    commandShell: preset.deps.commandShell,
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
  return preset.deps.processRun(vector, {
    timeoutMs: 5000,
    cwd: preset.deps.ctx.root,
    diagnostic: { phase: `${preset.step.id} ${phase}` },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verified(after: ProcessResult, changes: ServiceOutcome['changes']): ServiceOutcome {
  if (after.code !== 0 || object(after.stdout)['changed'] !== false)
    return { status: 'failed', detail: 'Service settings were not verified after preparation' };
  return {
    status: 'configured',
    detail: 'Public service settings prepared; personal login is separate',
    ...(changes ? { changes } : {}),
  };
}

function commandFailure(
  stderr: string,
  vector: readonly string[],
  deps: WorkspaceDeps,
): ServiceOutcome {
  const fields = errorEnvelope(stderr) ?? {};
  const code = fields['code'];
  const conflict = code === 'CONFIG_CONTEXT_CONFLICT';
  const session = code === 'BROWSER_MANAGED_SESSION';
  return {
    status: 'blocked',
    detail: typeof code === 'string' ? code : 'Companion service preparation failed',
    changes: publicChanges(fields['details']),
    next_steps: conflict
      ? [
          shellLine([...vector, '--overwrite', '--dry-run'], deps.commandShell),
          `After reviewing the differences: ${shellLine([...vector, '--overwrite'], deps.commandShell)}`,
        ]
      : [
          session
            ? 'Declare a new context and complete personal browser login.'
            : 'Inspect the companion CLI configuration and retry.',
        ],
  };
}

function publicChanges(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set([
    'server',
    'base_url',
    'flavor',
    'org',
    'auth.scheme',
    'auth.credential_url',
    'current_context',
  ]);
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, change]) => {
      if (!allowed.has(key) || !change || typeof change !== 'object') return [];
      const row = change as Record<string, unknown>;
      if (typeof row['before'] !== 'string' || typeof row['after'] !== 'string') return [];
      return [[key, { before: publicValue(row['before']), after: publicValue(row['after']) }]];
    }),
  );
}

function publicValue(value: string): string {
  if (!value.includes('://')) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return '[redacted non-public URL]';
    return value;
  } catch {
    return '[invalid public URL]';
  }
}
