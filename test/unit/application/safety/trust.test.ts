import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TrustGate } from '../../../../src/application/safety/trust.js';
import { fingerprint } from '../../../../src/domain/toolchain/trust.js';
import { FileLock } from '../../../../src/infra/lock.js';
import { FileTrustStore } from '../../../../src/infra/trust-store.js';
import { FakeClock } from '../../../fakes/fake-clock.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';
import { tempDir } from '../../../temp.js';

const vector = ['bitbucket-cli', 'auth', 'status'];
const writable = { readOnly: false, source: 'default' } as const;

function gate(overrides: { store?: FakeTrustStore; prompter?: FakePrompter } = {}) {
  const store = overrides.store ?? new FakeTrustStore();
  const prompter = overrides.prompter ?? new FakePrompter();
  return { gate: new TrustGate(store, prompter), store, prompter };
}

describe('fingerprint', () => {
  it('changes with any argument and is stable otherwise', () => {
    expect(fingerprint(vector)).toBe(fingerprint([...vector]));
    expect(fingerprint(vector)).not.toBe(fingerprint(['bitbucket-cli', 'auth', 'statuz']));
    expect(fingerprint(vector)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('TrustGate', () => {
  it('binds harness trust to reference names while preserving legacy vector records', async () => {
    const { gate: g, store, prompter } = gate();
    const input = {
      workspace: 'fx',
      vector: ['server'],
      label: 'MCP knowledge',
      origin: 'patch' as const,
      yes: false,
      posture: writable,
      execution: { purpose: 'mcp', resource: 'knowledge', bindings: { TOKEN: 'SOURCE_TOKEN' } },
    };
    await g.ensure(input);
    expect(await g.isTrusted(input)).toBe(true);
    expect(
      await g.isTrusted({
        ...input,
        execution: { ...input.execution, bindings: { TOKEN: 'OTHER_TOKEN' } },
      }),
    ).toBe(false);
    expect(await g.isTrusted({ ...input, execution: undefined })).toBe(false);
    expect(store.entries[0]?.fingerprint).not.toBe(fingerprint(input.vector));
    expect(prompter.questions[0]).toContain('SOURCE_TOKEN');
    expect(input.vector).toEqual(['server']);
  });

  it('lets a baseline vector through without touching the store or the person', async () => {
    const { gate: g, store, prompter } = gate();
    await g.ensure({
      workspace: 'fx',
      vector,
      label: 'bitbucket-cli auth',
      origin: 'base',
      yes: false,
      posture: writable,
    });
    expect(store.entries).toEqual([]);
    expect(prompter.questions).toEqual([]);
  });

  it('records a patch vector on --yes and never asks again for the same one', async () => {
    const { gate: g, store, prompter } = gate();
    await g.ensure({
      workspace: 'fx',
      vector,
      label: 'bitbucket-cli auth',
      origin: 'patch',
      yes: true,
      posture: writable,
    });
    expect(store.entries).toEqual([
      { workspace: 'fx', fingerprint: fingerprint(vector), label: 'bitbucket-cli auth' },
    ]);
    await g.ensure({
      workspace: 'fx',
      vector,
      label: 'bitbucket-cli auth',
      origin: 'patch',
      yes: false,
      posture: writable,
    });
    expect(prompter.questions).toEqual([]);
  });

  it('refuses to persist a new trust decision under read-only posture', async () => {
    const { gate: g, store, prompter } = gate();
    await expect(
      g.ensure({
        workspace: 'fx',
        vector,
        label: 'bitbucket-cli auth',
        origin: 'patch',
        yes: true,
        posture: { readOnly: true, source: 'env' },
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(store.entries).toEqual([]);
    expect(prompter.questions).toEqual([]);
  });

  it('asks the person once, showing the whole vector, and records on confirmation', async () => {
    const { gate: g, store, prompter } = gate();
    await g.ensure({
      workspace: 'fx',
      vector,
      label: 'bitbucket-cli auth',
      origin: 'patch',
      yes: false,
      posture: writable,
    });
    expect(prompter.questions[0]).toContain('bitbucket-cli auth status');
    expect(store.entries).toHaveLength(1);
  });

  it('refuses when the person declines', async () => {
    const prompter = new FakePrompter();
    prompter.confirmWith = false;
    const { gate: g, store } = gate({ prompter });
    await expect(
      g.ensure({
        workspace: 'fx',
        vector,
        label: 'bitbucket-cli auth',
        origin: 'patch',
        yes: false,
        posture: writable,
      }),
    ).rejects.toMatchObject({ category: 'permission', code: 'VECTOR_REJECTED' });
    expect(store.entries).toEqual([]);
  });

  it('fails structurally when nobody can answer, naming the vector and the way out', async () => {
    const prompter = new FakePrompter();
    prompter.unavailable = true;
    const { gate: g } = gate({ prompter });
    await expect(
      g.ensure({
        workspace: 'fx',
        vector,
        label: 'bitbucket-cli auth',
        origin: 'patch',
        yes: false,
        posture: writable,
      }),
    ).rejects.toMatchObject({
      category: 'config',
      code: 'VECTOR_UNTRUSTED',
      message: expect.stringContaining('bitbucket-cli auth status'),
      nextSteps: expect.arrayContaining([expect.stringContaining('authorized')]),
    });
  });

  it('asks again when one argument changes, and does not share trust across workspaces', async () => {
    const { gate: g, store, prompter } = gate();
    await g.ensure({
      workspace: 'fx',
      vector,
      label: 'a',
      origin: 'patch',
      yes: true,
      posture: writable,
    });
    await g.ensure({
      workspace: 'fx',
      vector: [...vector, '--verbose'],
      label: 'a',
      origin: 'patch',
      yes: false,
      posture: writable,
    });
    expect(prompter.questions).toHaveLength(1);
    await g.ensure({
      workspace: 'other',
      vector,
      label: 'a',
      origin: 'patch',
      yes: false,
      posture: writable,
    });
    expect(prompter.questions).toHaveLength(2);
    expect(store.entries).toHaveLength(3);
  });
});

describe('FileTrustStore', () => {
  it('retains every concurrently approved vector after reopening the store', async () => {
    const home = tempDir('fx-trust-concurrent-');
    const store = new FileTrustStore(home, new FakeClock(), new FileLock(home));
    const vectors = Array.from({ length: 20 }, (_, i) => fingerprint(['tool', String(i)]));
    await Promise.all(vectors.map((key, i) => store.trust('fx', key, `tool ${i}`)));
    const reopened = new FileTrustStore(home, new FakeClock(), new FileLock(home));
    expect((await reopened.list('fx')).map((entry) => entry.fingerprint).sort()).toEqual(
      [...vectors].sort(),
    );
  });

  it('round-trips fingerprints per workspace in trust.yaml', async () => {
    const home = tempDir('fx-home-');
    const store = new FileTrustStore(home, new FakeClock(), new FileLock(home));
    expect(await store.isTrusted('fx', 'abc')).toBe(false);
    await store.trust('fx', 'abc', 'bitbucket-cli auth');
    expect(await store.isTrusted('fx', 'abc')).toBe(true);
    expect(await store.isTrusted('other', 'abc')).toBe(false);
    expect(await store.list('fx')).toEqual([
      { fingerprint: 'abc', label: 'bitbucket-cli auth', trusted_at: '2026-09-01T00:00:00.000Z' },
    ]);
    expect(store.path()).toBe(path.join(home, 'trust.yaml'));
  });
});
