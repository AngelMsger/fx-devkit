// Native dry-run is the source of merge/conflict decisions. Never retry with overwrite.
import type { SetupStep } from '../../domain/setup/types.js';
import { shellLine } from '../../domain/shell.js';
import { errorEnvelope } from '../../domain/toolchain/stderr.js';
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

export async function prepareCommand(
  deps: WorkspaceDeps,
  login: LoginDeps,
  step: SetupStep,
  dryRun: boolean,
): Promise<ServiceOutcome> {
  const vector = step.run ?? [];
  const preview = [...vector, '--dry-run'];
  const trust = {
    ...login.trust,
    workspace: deps.ctx.name,
    commandShell: deps.commandShell,
    vector: preview,
    origin: 'patch' as const,
    label: `${step.id} preview`,
  };
  if (dryRun && !(await login.trust.gate.isTrusted(trust)))
    return {
      status: 'blocked',
      detail: 'Service preview command is not trusted',
      next_steps: [shellLine(preview, deps.commandShell)],
    };
  await login.trust.gate.ensure(trust);
  const result = await deps.processRun(preview, {
    timeoutMs: 5000,
    cwd: deps.ctx.root,
    diagnostic: { phase: `${step.id} preview` },
  });
  if (result.code !== 0) return commandFailure(result.stderr, vector, deps);
  const data = object(result.stdout);
  if (data['changed'] === false)
    return { status: 'unchanged', detail: 'Public service settings match' };
  if (data['changed'] !== true)
    return { status: 'failed', detail: 'Companion did not return a service configuration plan' };
  const changes = publicChanges(data['changes']);
  if (dryRun)
    return { status: 'planned', detail: 'Public service settings would be prepared', changes };
  assertWritable(login.trust.posture, step.id);
  await login.trust.gate.ensure({ ...trust, vector, label: step.id });
  const applied = await deps.processRun(vector, {
    timeoutMs: 5000,
    cwd: deps.ctx.root,
    diagnostic: { phase: `${step.id} prepare` },
  });
  if (applied.code !== 0) return commandFailure(applied.stderr, vector, deps);
  const after = await deps.processRun(preview, { timeoutMs: 5000, cwd: deps.ctx.root });
  if (after.code !== 0 || object(after.stdout)['changed'] !== false)
    return { status: 'failed', detail: 'Service settings were not verified after preparation' };
  return {
    status: 'configured',
    detail: 'Public service settings prepared; personal login is separate',
    changes,
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
