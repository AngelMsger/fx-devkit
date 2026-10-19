// Resolves declared MCP resources with shared typo recovery.

import { DevkitError } from '../../domain/errors.js';
import { nearest, suggestionHint } from '../../domain/fuzzy.js';
import type { Harness, McpResource } from '../../domain/manifest/types.js';

export function findMcpResource(harness: Harness | undefined, name: string): McpResource {
  const resource = harness?.mcp.find((item) => item.name === name);
  if (resource) return resource;
  const suggestion = nearest(name, harness?.mcp.map((item) => item.name) ?? []);
  throw new DevkitError('not_found', 'MCP_UNKNOWN', 'The MCP resource is not declared', {
    hint: suggestionHint(suggestion, 'The optional harness manifest declares MCP resources.'),
    nextSteps: ['fx mcp list', 'fx manifest explain --kind harness mcp'],
  });
}
