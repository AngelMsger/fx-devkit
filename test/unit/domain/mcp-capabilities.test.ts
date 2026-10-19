import { describe, expect, it } from 'vitest';

import { createAgentHosts } from '../../../src/composition/registry.js';
import { assessMcpSupport } from '../../../src/domain/harness/mcp.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakeProcess } from '../../fakes/fake-process.js';

const deps = { fs: FakeFs.from({}), process: new FakeProcess(), home: '/home' };
const resource = {
  name: 'knowledge',
  transport: 'stdio' as const,
  command: ['server'],
  env: { TOKEN: { from_env: 'SOURCE_TOKEN' } },
};

describe('MCP host capabilities', () => {
  it('supports a renamed environment reference on a host whose descriptor interpolates', () => {
    const [host] = createAgentHosts(deps, [
      {
        id: 'fixture',
        label: 'Fixture',
        homeSub: '.fixture',
        projectSkills: '.fixture/skills',
        markers: [],
        projectMarkers: [],
        binaries: [],
        mcp: {
          status: 'supported',
          projectPath: '.fixture/mcp.json',
          protocol: 'json',
          rootKey: 'mcpServers',
          references: 'interpolate',
        },
      },
    ]);
    expect(assessMcpSupport(host!.mcp, resource)).toEqual({ supported: true, reason: null });
  });
  it('does not expand values to emulate a host that only forwards same-name variables', () => {
    const host = createAgentHosts(deps).find((host) => host.id === 'codex')!;
    expect(assessMcpSupport(host.mcp, resource).supported).toBe(false);
    expect(
      assessMcpSupport(host.mcp, { ...resource, env: { TOKEN: { from_env: 'TOKEN' } } }).supported,
    ).toBe(true);
  });
});
