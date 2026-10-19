import { describe, expect, it } from 'vitest';

import { TrustGate } from '../../../../src/application/safety/trust.js';
import { ToolInitialize } from '../../../../src/application/tool/initialize.js';
import { ToolInstall } from '../../../../src/application/tool/install.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { loadTools } from '../../../../src/domain/manifest/loader.js';
import { resolveTools } from '../../../../src/domain/toolchain/resolve.js';
import { bundledTools } from '../../../bundled-tools.js';
import { FakeInstaller } from '../../../fakes/fake-installer.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { fakeToolAudit } from '../../../fakes/fake-tool-history.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';

function setup() {
  const loaded = loadTools(
    'schema_version: 3\ntools: [{name: base, enabled: false, install: [{via: manual}]}]',
    `schema_version: 3
tools:
  - name: example-log
    install_on_init: true
    min_version: '1.0.0'
    install: [{via: npm, spec: '@example/log'}]
  - name: not-selected
    install: [{via: npm, spec: '@example/other'}]
  - name: disabled
    enabled: false
    install_on_init: true
    install: [{via: npm, spec: '@example/disabled'}]
`,
    { cliVersion: '1.0.0' },
  );
  const process = new FakeProcess()
    .on(['npm'], { code: 0, stdout: '', stderr: '' })
    .on(['example-log'], { code: 0, stdout: '1.2.0', stderr: '' });
  const prompter = new FakePrompter();
  const posture = { readOnly: false, source: 'default' as const };
  const input = {
    tools: resolveTools(loaded.doc, loaded.provenance),
    posture,
    trust: {
      gate: new TrustGate(new FakeTrustStore(), prompter),
      workspace: 'test',
      yes: false,
      posture,
    },
  };
  const initialize = new ToolInitialize(
    new ToolInstall({ installers: FakeInstaller.family(['npm']), process, audit: fakeToolAudit() }),
  );
  return { process, prompter, input, initialize };
}

// A workspace that names bundled tools runs fx's own vectors, so the only thing left to
// approve is the automatic installation itself.
function bundled() {
  const loaded = loadTools(
    bundledTools(),
    `schema_version: 3
tools:
  - { name: jenkins-cli, install_on_init: true }
  - { name: openobserve-cli, install_on_init: true }
`,
    { cliVersion: '1.0.0' },
  );
  if (!loaded.valid) throw new Error('fixture patch rejected');
  const process = new FakeProcess()
    .on(['npm'], { code: 0, stdout: '', stderr: '' })
    .when((vector) => vector[1] === '--version', { code: 0, stdout: '99.0.0', stderr: '' });
  const prompter = new FakePrompter();
  const posture = { readOnly: false, source: 'default' as const };
  return {
    process,
    prompter,
    input: {
      tools: resolveTools(loaded.doc, loaded.provenance, loaded.declared),
      posture,
      trust: {
        gate: new TrustGate(new FakeTrustStore(), prompter),
        workspace: 'test',
        yes: false,
        posture,
      },
    },
    initialize: new ToolInitialize(
      new ToolInstall({
        installers: FakeInstaller.family(['npm']),
        process,
        audit: fakeToolAudit(),
      }),
    ),
  };
}

describe('manifest initialization installs', () => {
  it('asks once for the whole installation, however many tools it covers', async () => {
    const s = bundled();
    const result = await s.initialize.execute(s.input);
    expect(result.map((item) => item.name)).toEqual(['jenkins-cli', 'openobserve-cli']);
    expect(s.prompter.questions).toHaveLength(1);
    expect(s.prompter.questions[0]).toContain('@angelmsger/jenkins-cli');
    expect(s.prompter.questions[0]).toContain('@angelmsger/openobserve-cli');
  });

  it('installs only missing opt-ins after approving the exact installation and probe vectors', async () => {
    const s = setup();
    const result = await s.initialize.execute(s.input);
    expect(result).toMatchObject([
      { name: 'example-log', ran: true, code: 0, version_after: '1.2.0' },
    ]);
    expect(s.process.calls.map((c) => c.vector)).toEqual([
      ['npm', 'install', '-g', '@example/log@latest'],
      ['example-log', '--version'],
    ]);
    expect(s.prompter.questions).toHaveLength(2);
    s.process.binaries.add('example-log');
    s.process.calls.length = 0;
    expect(await s.initialize.execute(s.input)).toEqual([]);
    expect(s.process.calls).toEqual([]);
  });
  it.each([
    { answer: 'the person declines', unavailable: false, code: 'VECTOR_REJECTED' },
    { answer: 'nobody can answer', unavailable: true, code: 'VECTOR_UNTRUSTED' },
  ])('does not install when $answer', async ({ unavailable, code }) => {
    const s = setup();
    s.prompter.unavailable = unavailable;
    s.prompter.confirmWith = false;
    await expect(s.initialize.execute(s.input)).rejects.toMatchObject({ code });
    expect(s.process.calls).toEqual([]);
  });
  it('honors read-only posture before writing trust or installing', async () => {
    const s = setup();
    await expect(
      s.initialize.execute({ ...s.input, posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(s.process.calls).toEqual([]);
    expect(s.prompter.questions).toEqual([]);
  });
  it.each([
    { outcome: 'npm fails', code: 1, version: '1.2.0' },
    { outcome: 'the installed tool reports no version', code: 0, version: '' },
    { outcome: 'the installed version is below the requirement', code: 0, version: '0.1.0' },
  ])('fails initialization when $outcome', async ({ code, version }) => {
    const s = setup();
    s.process
      .clear()
      .on(['npm'], { code, stdout: '', stderr: '' })
      .on(['example-log'], { code: 0, stdout: version, stderr: '' });
    await expect(s.initialize.execute(s.input)).rejects.toMatchObject({
      code: 'INIT_TOOL_INSTALL_FAILED',
    });
  });

  it('lets an interruption through with the rows the installation had reached', async () => {
    const s = setup();
    const optIn = s.input.tools.find((tool) => tool.name === 'example-log')!;
    const tools = ['alpha', 'beta', 'gamma'].map((name) => ({
      ...optIn,
      name,
      binary: name,
      install: [{ via: 'npm' as const, spec: name }],
    }));
    s.process
      .clear()
      .on(
        ['npm', 'install', '-g', 'beta@latest'],
        new DevkitError('internal', 'PROCESS_ABORTED', 'interrupted'),
      )
      .always({ code: 0, stdout: '1.2.3', stderr: '' });
    await expect(
      s.initialize.execute({ ...s.input, tools, trust: { ...s.input.trust, yes: true } }),
    ).rejects.toMatchObject({
      code: 'PROCESS_ABORTED',
      partialResult: {
        tool_install: [
          { name: 'alpha', status: 'done', version_after: '1.2.3' },
          {
            name: 'beta',
            status: 'failed',
            phase: 'install',
            failure: { code: 'PROCESS_ABORTED' },
          },
          { name: 'gamma', status: 'not_started', ran: false },
        ],
      },
    });
  });
});
