// Describes native reference capabilities independently of agent identity.

import type { McpResource } from '../manifest/types.js';

export interface McpProjectionSupport {
  readonly status: 'supported';
  readonly projectPath: string;
  readonly protocol: string;
  readonly rootKey: string;
  readonly references: 'interpolate' | 'forward';
}
export type McpSupport =
  | McpProjectionSupport
  | {
      readonly status: 'unsupported' | 'unverified';
      readonly reason: string;
    };
export interface RulesSupport {
  readonly projectPath: string;
  readonly protocol: string;
}
export interface McpCompatibility {
  readonly supported: boolean;
  readonly reason: string | null;
}

export function assessMcpSupport(support: McpSupport, resource: McpResource): McpCompatibility {
  if (support.status !== 'supported') return { supported: false, reason: support.reason };
  if (
    support.references === 'forward' &&
    Object.entries(resource.env ?? {}).some(([key, ref]) => key !== ref.from_env)
  )
    return {
      supported: false,
      reason:
        'This host forwards same-name variables only; rename the environment reference at its source.',
    };
  return { supported: true, reason: null };
}

export function referencedVariables(resource: McpResource): readonly string[] {
  return [
    ...new Set(Object.values({ ...resource.env, ...resource.headers }).map((ref) => ref.from_env)),
  ].sort();
}
