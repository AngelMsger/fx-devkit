// Codecs transform one native entry with explicit prior ownership evidence.
// A digest identifies only the entry bytes, never the surrounding user document.

import type { McpProjectionSupport } from '../domain/harness/mcp.js';
import type { McpResource } from '../domain/manifest/types.js';

export interface McpProjectionInput {
  readonly current: string | null;
  readonly support: McpProjectionSupport;
  readonly name: string;
  readonly resource: McpResource | null;
  readonly owned: string | null;
}
export interface McpProjectionResult {
  readonly status: 'managed' | 'foreign' | 'conflict' | 'unsupported';
  readonly text: string | null;
  readonly digest: string | null;
}
export interface McpCodec {
  project(input: McpProjectionInput): McpProjectionResult;
}
