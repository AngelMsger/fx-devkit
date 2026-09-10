// Harness plans and results carry reference names, never environment values.

import type { HandoffEnvelope } from '../../domain/errors.js';
import type { McpProjectionSupport } from '../../domain/harness/mcp.js';
import type { HarnessReceipt, HarnessState } from '../../domain/harness/ownership.js';
import type { RulesProjectionInput, RulesProjectionResult } from '../../domain/harness/rules.js';
import type { Harness, McpResource } from '../../domain/manifest/types.js';
import type { AgentHost } from '../../ports/agent-host.js';
import type { HarnessStateStore } from '../../ports/harness-state.js';
import type { Lock } from '../../ports/lock.js';
import type { McpCodec } from '../../ports/mcp-codec.js';
import type { ProjectionSnapshot, ProjectionStore } from '../../ports/projection.js';
import type { WritePosture } from '../safety/posture.js';
import type { TrustGate, TrustInput } from '../safety/trust.js';

export interface HarnessDeps {
  readonly hosts: readonly AgentHost[];
  readonly state: HarnessStateStore;
  readonly files: ProjectionStore;
  readonly lock: Lock;
  readonly trust: TrustGate;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly rules?: (
    protocol: string,
  ) => ((input: RulesProjectionInput) => RulesProjectionResult) | undefined;
  readonly codec: (protocol: string) => McpCodec | undefined;
}
export interface HarnessInput {
  readonly workspace: string;
  readonly root: string;
  readonly harness: Harness | undefined;
  readonly selected: readonly string[];
  readonly action: 'inspect' | 'sync';
  readonly only?: 'mcp' | 'rules' | undefined;
  readonly cleanupAgents?: readonly string[] | undefined;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly posture: WritePosture;
  readonly source?:
    | { readonly root: string; readonly relative: string; readonly before: ProjectionSnapshot }
    | undefined;
}
export interface HarnessRow {
  readonly key: string;
  readonly kind: 'mcp' | 'rules';
  readonly name: string;
  readonly agents: readonly string[];
  readonly path: string | null;
  readonly action: string;
  readonly variables: readonly string[];
  readonly handoff: HandoffEnvelope | null;
}
export interface HarnessOutput {
  readonly items: readonly HarnessRow[];
  readonly written: boolean;
}
export interface HarnessChange {
  readonly key: string;
  readonly relative: string;
  readonly before: ProjectionSnapshot;
  readonly text: string | null;
  readonly receipt: HarnessReceipt | null;
}
export interface HarnessPlan {
  readonly items: readonly HarnessRow[];
  readonly changes: readonly HarnessChange[];
  readonly trusts: readonly TrustInput[];
  readonly state: HarnessState;
}
export interface HarnessTarget {
  readonly key: string;
  readonly kind: 'mcp' | 'rules';
  readonly name: string;
  readonly relative: string;
  readonly protocol: string;
  readonly agents: readonly string[];
  readonly resource: McpResource | null;
  readonly support: McpProjectionSupport | null;
  readonly remove: boolean;
}
