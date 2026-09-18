// What `can` was asked about and what it concluded. A verdict is never an error:
// an unready target still answers, with the steps that would make it ready.

import type { Capability } from '../../domain/capability.js';
import type { HandoffEnvelope } from '../../domain/errors.js';
import type { Binding, PlatformBinding } from '../../domain/manifest/providers.js';
import type { SetupStep } from '../../domain/setup/types.js';
import type { ResolvedTool } from '../../domain/toolchain/resolve.js';

export type ReadyStatus =
  | 'ready'
  | 'missing_tool'
  | 'outdated_tool'
  | 'disabled_tool'
  | 'unconfigured'
  | 'no_access'
  | 'not_covered'
  | 'unknown';

export type ToolState = 'ok' | 'missing' | 'outdated' | 'disabled' | 'unknown' | 'untrusted';

export type PendingSteps = SetupStep[] | 'untrusted' | { readonly problems: readonly string[] };

export interface Target {
  readonly capability: Capability | null;
  readonly tool: ResolvedTool | null;
  readonly binding: Binding | PlatformBinding | null;
}

export interface Verdict {
  readonly status: ReadyStatus;
  readonly handoff: HandoffEnvelope | null;
  readonly alternatives: readonly string[];
}
