// Bounds aggregate MCP readiness work across a collection of resources.

import type { McpResource } from '../../domain/manifest/types.js';
import { pooled } from '../pool.js';
import type { WritePosture } from '../safety/posture.js';

import { McpReadiness, type McpReadinessDeps, type McpVerdict } from './mcp-readiness.js';

export interface McpReadinessBatchInput {
  readonly workspace: string;
  readonly resources: readonly McpResource[];
  readonly posture: WritePosture;
}
export class McpReadinessBatch {
  constructor(private readonly deps: McpReadinessDeps) {}
  async execute(input: McpReadinessBatchInput): Promise<readonly McpVerdict[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    timer.unref();
    const readiness = new McpReadiness(this.deps);
    try {
      return await pooled(input.resources, 4, (resource) =>
        readiness.execute({
          workspace: input.workspace,
          resource,
          agent: null,
          posture: input.posture,
          signal: controller.signal,
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
