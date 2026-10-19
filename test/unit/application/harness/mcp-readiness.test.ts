import { describe, expect, it } from 'vitest';

import { McpReadiness } from '../../../../src/application/harness/mcp-readiness.js';
import { mcpTrust, mcpCheckTrust } from '../../../../src/application/harness/plan.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';

const resource = {
  name: 'knowledge',
  transport: 'stdio' as const,
  command: ['server'],
  env: { TOKEN: { from_env: 'TOKEN' } },
  variables: { TOKEN: { instructions: 'Obtain access.' } },
  check: { command: ['checker', 'status'] },
};
const input = {
  workspace: 'test',
  resource,
  agent: null,
  posture: { readOnly: false, source: 'default' as const },
};
async function fixture() {
  const process = new FakeProcess();
  const trust = new TrustGate(new FakeTrustStore(), new FakePrompter());
  const context = { ...input, yes: true };
  await trust.ensure(mcpTrust(context, resource));
  await trust.ensure(mcpCheckTrust(context, resource));
  return { process, trust };
}

describe('MCP readiness', () => {
  it('distinguishes missing binaries, missing variables, failed checks and current readiness', async () => {
    const f = await fixture();
    const run = (env: Record<string, string>) => new McpReadiness({ ...f, env }).execute(input);
    expect((await run({ TOKEN: 'synthetic' })).status).toBe('missing_tool');
    f.process.binaries.add('server');
    f.process.binaries.add('checker');
    expect((await run({})).status).toBe('unconfigured');
    f.process.always({ code: 8, stdout: '', stderr: 'synthetic-sensitive-value' });
    const unavailable = await run({ TOKEN: 'synthetic' });
    expect(unavailable).toMatchObject({ status: 'unknown', handoff: expect.any(Object) });
    expect(JSON.stringify(unavailable)).not.toContain('synthetic-sensitive-value');
    f.process.clear().always({ code: 0, stdout: '{}', stderr: '' });
    expect((await run({ TOKEN: 'synthetic' })).status).toBe('ready');
    expect(
      f.process.calls.every(
        (call) =>
          call.vector[0] === 'checker' &&
          call.options.timeoutMs === 2000 &&
          call.options.sensitiveOutput === true,
      ),
    ).toBe(true);
  });
  it.each([4, 5])(
    'reads a check that exits %i as access to configure, not as no answer',
    async (code) => {
      const f = await fixture();
      f.process.binaries.add('server');
      f.process.binaries.add('checker');
      f.process.always({ code, stdout: '', stderr: '' });
      const result = await new McpReadiness({ ...f, env: { TOKEN: 'synthetic' } }).execute(input);
      expect(result.status).toBe('unconfigured');
    },
  );
  it('returns an untrusted handoff without recording trust or invoking a command', async () => {
    const process = new FakeProcess();
    process.binaries.add('server');
    const store = new FakeTrustStore();
    const result = await new McpReadiness({
      process,
      trust: new TrustGate(store, new FakePrompter()),
      env: { TOKEN: 'synthetic' },
    }).execute(input);
    expect(result.status).toBe('unconfigured');
    expect(result.handoff).not.toBeNull();
    expect(store.entries).toEqual([]);
    expect(process.calls).toEqual([]);
  });
  it('requires the declared JSON readiness field even when a check exits successfully', async () => {
    const f = await fixture();
    f.process.binaries.add('server');
    f.process.binaries.add('checker');
    f.process.always({ code: 0, stdout: '{"ready":false}', stderr: '' });
    const result = await new McpReadiness({ ...f, env: { TOKEN: 'synthetic' } }).execute({
      ...input,
      resource: {
        ...resource,
        check: { ...resource.check, json: { path: 'ready', equals: true } },
      },
    });
    expect(result.status).toBe('unconfigured');
  });
});
