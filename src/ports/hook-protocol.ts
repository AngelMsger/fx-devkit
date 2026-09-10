// A host codec plans text without touching disk or running commands. The
// caller owns locks, trust, posture and persistence for every host format.

import type { HookEvent, HookInvocation, HookSupport } from '../domain/harness/hooks.js';

export interface HookProjectionInput {
  readonly current: string | null;
  readonly owner: string;
  readonly event: string;
  readonly vector: readonly string[];
  readonly remove: boolean;
}

export interface HookProjection {
  readonly empty?: boolean;
  readonly text: string | null;
  readonly status: 'managed' | 'foreign' | 'invalid';
}

export interface HookProtocol {
  project(input: HookProjectionInput): HookProjection;
  context(text: string, support: HookSupport, event?: HookEvent): string;
  decode(text: string, support: HookSupport): HookInvocation | null;
}
