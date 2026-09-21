import { describe, expect, it } from 'vitest';

import { ToolCheck } from '../../../../src/application/tool/check.js';
import { ToolList } from '../../../../src/application/tool/list.js';
import { loadTools } from '../../../../src/domain/manifest/loader.js';
import { resolveTools } from '../../../../src/domain/toolchain/resolve.js';
import { FakeProcess } from '../../../fakes/fake-process.js';

const bundled = [
  'schema_version: 3',
  'defaults: { version_args: [--version], install: [{ via: npm }], npm_scope: "@example" }',
  'tools:',
  '  - name: alpha',
  '    required: true',
  '    min_version: 1.0.0',
  '  - name: beta',
  '    min_version: 2.0.0',
  '  - name: gamma',
  '  - name: retired',
  '    enabled: false',
  '  - name: flaky',
].join('\n');

function tools(patch?: string) {
  const loaded = loadTools(bundled, patch, { cliVersion: '1.0.0' });
  return resolveTools(loaded.doc, loaded.provenance);
}

describe('ToolCheck', () => {
  it('classifies every tool from what is on the machine', async () => {
    const proc = new FakeProcess()
      .on(['alpha', '--version'], { code: 0, stdout: 'alpha v1.4.0 (commit x)\n', stderr: '' })
      .on(['beta', '--version'], { code: 0, stdout: 'beta 1.9.9\n', stderr: '' })
      .on(['flaky', '--version'], { code: 1, stdout: '', stderr: 'boom\n' });
    proc.binaries.add('alpha').add('beta').add('flaky');
    const rows = await new ToolCheck(proc).execute({ tools: tools() });
    expect(rows.map((r) => [r.name, r.state, r.installed])).toEqual([
      ['alpha', 'ok', '1.4.0'],
      ['beta', 'outdated', '1.9.9'],
      ['gamma', 'missing', null],
      ['retired', 'disabled', null],
      ['flaky', 'unknown', null],
    ]);
    expect(rows[0]).toMatchObject({
      required: true,
      min_version: '1.0.0',
      binary: 'alpha',
      install: { via: 'npm' },
    });
    expect(proc.calls.some((c) => c.vector[0] === 'retired')).toBe(false);
  });

  it('restricts itself to the named tools and rejects an unknown name', async () => {
    const proc = new FakeProcess();
    const rows = await new ToolCheck(proc).execute({ tools: tools(), names: ['gamma'] });
    expect(rows.map((r) => r.name)).toEqual(['gamma']);
    await expect(
      new ToolCheck(proc).execute({ tools: tools(), names: ['gama'] }),
    ).rejects.toMatchObject({
      code: 'TOOL_UNKNOWN',
      hint: expect.stringContaining('gamma'),
    });
  });

  it('does not accept version-looking output from a failed probe', async () => {
    const proc = new FakeProcess().on(['alpha', '--version'], {
      code: 1,
      stdout: 'alpha v1.4.0',
      stderr: 'startup failed on runtime 24.14.0',
    });
    proc.binaries.add('alpha');
    expect(await new ToolCheck(proc).execute({ tools: tools(), names: ['alpha'] })).toMatchObject([
      { name: 'alpha', state: 'unknown', installed: null },
    ]);
  });
});

describe('ToolList', () => {
  it('summarises each entry with where its fields came from', () => {
    const rows = new ToolList().execute({
      tools: tools('schema_version: 3\ntools: [{ name: beta, min_version: 3.0.0 }]'),
      sources: new Map([['beta', { kind: 'binding' as const, boundBy: ['ci:build'] }]]),
    });
    expect(rows.find((r) => r.name === 'beta')).toMatchObject({
      min_version: '3.0.0',
      origin: 'mixed',
      install_via: 'npm',
      source: 'binding',
      bound_by: ['ci:build'],
    });
    expect(rows.find((r) => r.name === 'alpha')).toMatchObject({
      origin: 'base',
      required: true,
      enabled: true,
      source: 'catalog',
      bound_by: [],
    });
    expect(rows.find((r) => r.name === 'retired')).toMatchObject({ enabled: false });
  });
});

describe('ToolCheck with a trust gate', () => {
  it('runs a patch-supplied version vector only after the gate lets it through', async () => {
    const { TrustGate } = await import('../../../../src/application/safety/trust.js');
    const { FakeTrustStore } = await import('../../../fakes/fake-trust-store.js');
    const { FakePrompter } = await import('../../../fakes/fake-prompter.js');
    const { FakeClock } = await import('../../../fakes/fake-clock.js');
    const proc = new FakeProcess().always({ code: 0, stdout: 'alpha v1.4.0', stderr: '' });
    proc.binaries.add('alpha');
    const patched = tools('schema_version: 3\ntools: [{ name: alpha, version_args: [--ver] }]');
    const prompter = new FakePrompter();
    prompter.unavailable = true;
    const gate = new TrustGate(new FakeTrustStore(), prompter, new FakeClock());
    await expect(
      new ToolCheck(proc).execute({
        tools: patched,
        names: ['alpha'],
        trust: {
          gate,
          workspace: 'fx',
          yes: false,
          posture: { readOnly: false, source: 'default' },
        },
      }),
    ).rejects.toMatchObject({ code: 'VECTOR_UNTRUSTED' });
    expect(proc.calls).toEqual([]);
    const rows = await new ToolCheck(proc).execute({
      tools: patched,
      names: ['alpha'],
      trust: {
        gate,
        workspace: 'fx',
        yes: true,
        posture: { readOnly: false, source: 'default' },
      },
    });
    expect(rows[0]?.state).toBe('ok');
    expect(proc.vectors(), 'the untrusted attempt never ran').toEqual([['alpha', '--ver']]);
  });
});
