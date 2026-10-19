import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { InspectMcp } from '../../../../src/application/harness/inspect.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import { createAgentHosts, mcpCodecFor } from '../../../../src/composition/registry.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeHarnessState, FakeProjectionStore } from '../../../fakes/fake-harness.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';

const resource = {
  name: 'knowledge',
  transport: 'stdio' as const,
  command: ['server'],
  env: { TOKEN: { from_env: 'TOKEN' } },
  variables: { TOKEN: { instructions: 'Obtain access.' } },
};
const input = {
  workspace: 'test',
  root: path.resolve('/workspace'),
  harness: { schema_version: 2, mcp: [resource] },
  selected: ['claude-code'],
  action: 'inspect' as const,
  dryRun: true,
  yes: false,
  posture: { readOnly: true, source: 'env' as const },
};
function fixture() {
  const process = new FakeProcess();
  const state = new FakeHarnessState();
  const files = new FakeProjectionStore();
  const trustStore = new FakeTrustStore();
  return {
    state,
    files,
    trustStore,
    inspect: new InspectMcp({
      process,
      hosts: createAgentHosts({ fs: FakeFs.from({}), process, home: path.resolve('/home') }),
      state,
      files,
      lock: { acquire: async () => ({ release: async () => {} }) },
      env: { TOKEN: 'opaque-sensitive-value' },
      codec: mcpCodecFor,
      trust: new TrustGate(trustStore, new FakePrompter()),
    }),
  };
}
describe('MCP inspection', () => {
  it('shows declarations, projections and readiness without exposing environment values or writing state', async () => {
    const f = fixture();
    const result = await f.inspect.execute(input);
    expect(result.items[0]).toMatchObject({
      name: 'knowledge',
      description: null,
      transport: 'stdio',
      env: { TOKEN: { from_env: 'TOKEN' } },
      readiness: { status: 'missing_tool' },
      projections: expect.any(Array),
    });
    expect(JSON.stringify(result)).not.toContain('opaque-sensitive-value');
    expect(f.state.writes + f.files.writes + f.trustStore.entries.length).toBe(0);
  });
  it('returns an empty collection without a document and rejects misspelled names', async () => {
    const f = fixture();
    expect((await f.inspect.execute({ ...input, harness: undefined })).items).toEqual([]);
    await expect(f.inspect.execute({ ...input, name: 'knowledg' })).rejects.toMatchObject({
      code: 'MCP_UNKNOWN',
    });
  });
});
