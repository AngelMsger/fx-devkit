// Decode native context previews and conflicts, exposing only allowlisted public changes.

import { errorEnvelope } from '../../domain/toolchain/stderr.js';
import type {
  ServiceChanges,
  ServiceFailure,
  ServicePlan,
  ServiceProtocol,
} from '../../ports/service-protocol.js';

import { objectOf } from './cli.js';

export class FamilyServiceProtocol implements ServiceProtocol {
  plan(stdout: string): ServicePlan {
    let data: Record<string, unknown> | undefined;
    try {
      data = objectOf(JSON.parse(stdout));
    } catch {
      return { kind: 'unreadable' };
    }
    if (data?.['changed'] === false) return { kind: 'unchanged' };
    if (data?.['changed'] !== true) return { kind: 'unreadable' };
    const changes = objectOf(data['changes']);
    return {
      kind: 'changes',
      createsContext: changes !== undefined && 'auth.scheme' in changes,
      changes: publicChanges(changes),
    };
  }

  failure(stderr: string): ServiceFailure {
    const fields = errorEnvelope(stderr) ?? {};
    const code = typeof fields['code'] === 'string' ? fields['code'] : null;
    return {
      kind: failureKind(code),
      code,
      changes: publicChanges(fields['details']),
    };
  }
}

function failureKind(code: string | null): ServiceFailure['kind'] {
  if (code === 'CONFIG_CONTEXT_CONFLICT') return 'conflict';
  if (code === 'BROWSER_MANAGED_SESSION') return 'managed_session';
  return 'unknown';
}

function publicChanges(value: unknown): ServiceChanges {
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
    Object.entries(objectOf(value) ?? {}).flatMap(([key, change]) => {
      if (!allowed.has(key)) return [];
      const row = objectOf(change);
      if (typeof row?.['before'] !== 'string' || typeof row['after'] !== 'string') return [];
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
