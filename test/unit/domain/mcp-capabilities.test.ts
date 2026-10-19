import { describe, expect, it } from 'vitest';

import { assessMcpSupport, type McpProjectionSupport } from '../../../src/domain/harness/mcp.js';

const resource = {
  name: 'knowledge',
  transport: 'stdio' as const,
  command: ['server'],
  env: { TOKEN: { from_env: 'SOURCE_TOKEN' } },
};
const interpolating: McpProjectionSupport = {
  status: 'supported',
  projectPath: '.fixture/mcp.json',
  protocol: 'json',
  rootKey: 'mcpServers',
  references: 'interpolate',
};
const forwarding: McpProjectionSupport = { ...interpolating, references: 'forward' };

describe('MCP host capabilities', () => {
  it('supports a renamed environment reference on a host whose descriptor interpolates', () => {
    expect(assessMcpSupport(interpolating, resource)).toEqual({ supported: true, reason: null });
  });
  it('does not expand values to emulate a host that only forwards same-name variables', () => {
    expect(assessMcpSupport(forwarding, resource).supported).toBe(false);
    expect(
      assessMcpSupport(forwarding, { ...resource, env: { TOKEN: { from_env: 'TOKEN' } } })
        .supported,
    ).toBe(true);
  });
});
