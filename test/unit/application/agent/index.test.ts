import { describe, expect, it } from 'vitest';

import { AgentList } from '../../../../src/application/agent/list.js';
import { AgentPick } from '../../../../src/application/agent/pick.js';
import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { FakeConfigStore } from '../../../fakes/fake-config-store.js';

const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };

describe('AgentList', () => {
  const hosts = [
    new FakeAgentHost('claude-code', true),
    new FakeAgentHost('codex', true),
    new FakeAgentHost('roo', false),
  ];

  it('enables the detected agents when nothing is configured', async () => {
    const rows = await new AgentList(hosts).execute({ configured: undefined });
    expect(rows.map((r) => [r.id, r.detected, r.enabled])).toEqual([
      ['claude-code', true, true],
      ['codex', true, true],
      ['roo', false, false],
    ]);
    expect(rows[0]?.skills_dir).toContain('claude-code');
  });

  it('follows config.agents when set, and flags an enabled agent that is not there', async () => {
    const rows = await new AgentList(hosts).execute({ configured: ['codex', 'roo'] });
    expect(rows.map((r) => [r.id, r.enabled, r.note])).toEqual([
      ['claude-code', false, null],
      ['codex', true, null],
      ['roo', true, 'enabled in config but not detected on this machine'],
    ]);
  });

  it('treats an empty configured list as an explicit choice to enable no agent', async () => {
    const rows = await new AgentList(hosts).execute({ configured: [] });
    expect(rows.map((row) => [row.id, row.enabled])).toEqual([
      ['claude-code', false],
      ['codex', false],
      ['roo', false],
    ]);
  });
});

describe('AgentPick', () => {
  const hosts = [
    new FakeAgentHost('claude-code', true),
    new FakeAgentHost('codex', true),
    new FakeAgentHost('roo', false),
  ];

  it('starts an explicit list from the detected set when unpicking under auto mode', async () => {
    const config = new FakeConfigStore({});
    const result = await new AgentPick(config, hosts).execute({
      ids: ['codex'],
      action: 'unpick',
      dryRun: false,
      posture: writable,
    });
    expect(result).toMatchObject({ before: null, after: ['claude-code'], written: true });
    expect((await config.read()).agents).toEqual(['claude-code']);
  });

  it('adds to and removes from an explicit list, keeping other config keys', async () => {
    const config = new FakeConfigStore({ format: 'json', agents: ['codex'] });
    await new AgentPick(config, hosts).execute({
      ids: ['roo'],
      action: 'pick',
      dryRun: false,
      posture: writable,
    });
    expect(await config.read()).toEqual({ format: 'json', agents: ['codex', 'roo'] });
    const noop = await new AgentPick(config, hosts).execute({
      ids: ['roo'],
      action: 'pick',
      dryRun: false,
      posture: writable,
    });
    expect(noop).toMatchObject({ changed: false, written: false });
  });

  it('persists a new agent when deduplication keeps the list length unchanged', async () => {
    const config = new FakeConfigStore({ agents: ['codex', 'codex'] });
    const result = await new AgentPick(config, hosts).execute({
      ids: ['roo'],
      action: 'pick',
      dryRun: false,
      posture: writable,
    });
    expect(result).toMatchObject({ changed: true, written: true, after: ['codex', 'roo'] });
    expect((await config.read()).agents).toEqual(['codex', 'roo']);
  });

  it('preserves an explicit empty list when picking or unpicking', async () => {
    const config = new FakeConfigStore({ agents: [] });
    const unchanged = await new AgentPick(config, hosts).execute({
      ids: ['codex'],
      action: 'unpick',
      dryRun: false,
      posture: writable,
    });
    expect(unchanged).toMatchObject({ before: [], after: [], changed: false, written: false });

    const picked = await new AgentPick(config, hosts).execute({
      ids: ['roo'],
      action: 'pick',
      dryRun: false,
      posture: writable,
    });
    expect(picked).toMatchObject({ before: [], after: ['roo'], changed: true, written: true });
  });

  it('applies the selection to the list the write actually read', async () => {
    const config = new FakeConfigStore({ agents: ['codex'] });
    const original = config.update.bind(config);
    config.update = (change) =>
      original(async (current) => change({ ...current, agents: ['roo'] }));
    const result = await new AgentPick(config, hosts).execute({
      ids: ['claude-code'],
      action: 'pick',
      dryRun: false,
      posture: writable,
    });
    expect(result.after).toEqual(['roo', 'claude-code']);
    expect((await config.read()).agents).toEqual(['roo', 'claude-code']);
  });

  it('previews under dry-run, refuses under read-only, and rejects an unknown id with a suggestion', async () => {
    const config = new FakeConfigStore({});
    const preview = await new AgentPick(config, hosts).execute({
      ids: ['roo'],
      action: 'pick',
      dryRun: true,
      posture: locked,
    });
    expect(preview).toMatchObject({ after: ['claude-code', 'codex', 'roo'], written: false });
    expect(await config.read()).toEqual({});
    await expect(
      new AgentPick(config, hosts).execute({
        ids: ['roo'],
        action: 'pick',
        dryRun: false,
        posture: locked,
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    await expect(
      new AgentPick(config, hosts).execute({
        ids: ['codx'],
        action: 'pick',
        dryRun: false,
        posture: writable,
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_UNKNOWN',
      message: '"codx" is not an agent fx knows',
      hint: 'Did you mean "codex"?',
    });
  });
});
