import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ReconcileHarness } from '../../../../src/application/harness/reconcile.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import { createAgentHosts, mcpCodecFor } from '../../../../src/composition/registry.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeHarnessState, FakeProjectionStore } from '../../../fakes/fake-harness.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';

const harness = {
  schema_version: 2,
  mcp: [
    {
      name: 'knowledge',
      transport: 'stdio' as const,
      command: ['server'],
      env: { TOKEN: { from_env: 'TOKEN' } },
      variables: { TOKEN: { instructions: 'Obtain team access.' } },
    },
  ],
};
const input = {
  workspace: 'test',
  root: path.resolve('/workspace'),
  harness,
  selected: ['claude-code'],
  action: 'sync' as const,
  dryRun: false,
  yes: true,
  posture: { readOnly: false, source: 'default' as const },
};
function fixture() {
  const state = new FakeHarnessState();
  const files = new FakeProjectionStore();
  const trustStore = new FakeTrustStore();
  const prompter = new FakePrompter();
  const deps = {
    hosts: createAgentHosts({
      fs: FakeFs.from({}),
      process: new FakeProcess(),
      home: path.resolve('/home'),
    }),
    state,
    files,
    trust: new TrustGate(trustStore, prompter, new FakeClock()),
    env: { TOKEN: 'synthetic-sensitive-value' },
    codec: mcpCodecFor,
    lock: { acquire: async () => ({ release: async () => {} }) },
  };
  return { state, files, trustStore, prompter, deps, run: new ReconcileHarness(deps) };
}
describe('harness reconciliation', () => {
  it('previews without state and persists only references after trust', async () => {
    const f = fixture();
    await f.run.execute({ ...input, dryRun: true });
    expect(f.files.writes + f.state.writes + f.trustStore.entries.length).toBe(0);
    const result = await f.run.execute(input);
    expect(result.items[0]?.action).toBe('created');
    expect(f.files.files.get('.mcp.json')).toContain('${TOKEN}');
    expect(JSON.stringify([...f.files.files, f.state.value])).not.toContain(
      'synthetic-sensitive-value',
    );
    await f.run.execute(input);
    expect(f.files.writes).toBe(1);
  });
  it('resumes after a file write but interrupted receipt write without adopting user edits', async () => {
    const f = fixture();
    f.state.failAt = 2;
    await expect(f.run.execute(input)).rejects.toMatchObject({ code: 'FIXTURE_FAILURE' });
    expect(f.state.value?.pending).not.toBeNull();
    expect(f.files.writes).toBe(1);
    f.state.failAt = null;
    await f.run.execute(input);
    expect(f.state.value?.pending).toBeNull();
    expect(f.files.writes).toBe(1);
  });
  it('leaves missing variables and foreign entries with handoffs', async () => {
    const f = fixture();
    const missing = {
      ...input,
      harness: {
        ...harness,
        mcp: [
          {
            ...harness.mcp[0]!,
            env: { TOKEN: { from_env: 'ABSENT' } },
            variables: { ABSENT: { instructions: 'Obtain access.' } },
          },
        ],
      },
    };
    const result = await f.run.execute(missing);
    expect(result.items[0]).toMatchObject({
      action: 'missing_variables',
      handoff: expect.any(Object),
    });
    expect(f.files.writes).toBe(0);
    f.files.files.set('.mcp.json', '{"mcpServers":{"fx-knowledge":{"command":"mine"}}}');
    expect((await f.run.execute(input)).items[0]?.action).toBe('foreign');
  });
  it('plans multiple resources in one native file without overwriting earlier entries', async () => {
    const f = fixture();
    await f.run.execute({
      ...input,
      harness: { ...harness, mcp: [harness.mcp[0]!, { ...harness.mcp[0]!, name: 'second' }] },
    });
    const servers = JSON.parse(f.files.files.get('.mcp.json')!).mcpServers;
    expect(Object.keys(servers)).toEqual(['fx-knowledge', 'fx-second']);
    expect(f.state.value?.receipts).toHaveLength(2);
  });
  it('refuses new trust non-interactively and preserves read-only state', async () => {
    const f = fixture();
    f.prompter.unavailable = true;
    await expect(f.run.execute({ ...input, yes: false })).rejects.toMatchObject({
      code: 'VECTOR_UNTRUSTED',
    });
    await expect(
      f.run.execute({ ...input, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(f.files.writes + f.state.writes + f.trustStore.entries.length).toBe(0);
  });
  it('cleans a removed declaration but retains a shared target while another host needs it', async () => {
    const f = fixture();
    const original = f.deps.hosts.find((host) => host.id === 'claude-code')!;
    const alias = {
      id: 'fixture',
      label: 'Fixture',
      mcp: original.mcp,
      rules: null,
      hooks: null,
      detect: async () => true,
      skillsDir: () => '.fixture/skills',
    };
    const run = new ReconcileHarness({ ...f.deps, hosts: [original, alias] });
    await run.execute({ ...input, selected: ['claude-code', 'fixture'] });
    expect(f.state.value?.receipts[0]?.agents).toEqual(['claude-code', 'fixture']);
    await run.execute({ ...input, selected: ['fixture'] });
    expect(f.files.writes).toBe(1);
    expect(f.state.value?.receipts[0]?.agents).toEqual(['fixture']);
    await run.execute({ ...input, selected: [] });
    expect(f.state.value?.receipts).toEqual([]);
    expect(JSON.parse(f.files.files.get('.mcp.json')!).mcpServers).toEqual({});
  });
  it('does not fall back to Markdown for an unregistered rules protocol', async () => {
    const f = fixture();
    const host = {
      id: 'fixture',
      label: 'Fixture',
      mcp: f.deps.hosts[0]!.mcp,
      rules: { projectPath: 'RULES.yaml', protocol: 'unregistered' },
      hooks: null,
      detect: async () => true,
      skillsDir: () => '.fixture/skills',
    };
    const result = await new ReconcileHarness({ ...f.deps, hosts: [host] }).execute({
      ...input,
      selected: ['fixture'],
      only: 'rules',
    });
    expect(result.items[0]?.action).toBe('unsupported');
    expect(f.files.writes).toBe(0);
  });
});
