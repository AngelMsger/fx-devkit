import { describe, expect, it } from 'vitest';

import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { TrustGate } from '../../../../src/application/safety/trust.js';
import { ToolInstall } from '../../../../src/application/tool/install.js';
import { ToolInstallWithSkills } from '../../../../src/application/tool/with-skills.js';
import { loadTools } from '../../../../src/domain/manifest/loader.js';
import { resolveTools } from '../../../../src/domain/toolchain/resolve.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { FakeInstaller } from '../../../fakes/fake-installer.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';
import { fakeToolAudit } from '../../../fakes/fake-tool-history.js';
import { FakeTrustStore } from '../../../fakes/fake-trust-store.js';

const catalog = [
  'schema_version: 3',
  'defaults:',
  '  install: [{ via: npm }]',
  '  npm_scope: "@example"',
  '  skill: { command: [skill, install], dir_flag: --dir }',
  'tools:',
  '  - { name: alpha }',
  '  - { name: beta }',
  '  - name: byhand',
  '    install: [{ via: manual }]',
].join('\n');

const writable: WritePosture = { readOnly: false, source: 'default' };
const agent = new FakeAgentHost('claude-code', true);
const skillsDir = agent.skillsDir('global');

function setup(patch?: string) {
  const loaded = loadTools(catalog, patch, { cliVersion: '1.0.0' });
  const tools = resolveTools(loaded.doc, loaded.provenance);
  const proc = new FakeProcess()
    .on(['npm', 'install', '-g'], (vector) => {
      proc.binaries.add(vector[3]!.replace(/^@example\/|@latest$/g, ''));
      return { code: 0, stdout: '', stderr: '' };
    })
    .always({ code: 0, stdout: '1.0.0\n', stderr: '' });
  proc.binaries.add('alpha');
  proc.binaries.add('byhand');
  const reporter = new FakeReporter();
  const command = new ToolInstallWithSkills({
    install: new ToolInstall({
      installers: FakeInstaller.family(['npm']),
      process: proc,
      audit: fakeToolAudit(),
    }),
    process: proc,
    reporter,
    skills: {
      hosts: [agent],
      configured: undefined,
      bundledSkillDir: '/pkg/skills/fx-workspace',
      globalLock: new FakeLock(),
    },
  });
  return { tools, proc, reporter, command };
}

describe('installing or updating tools from the tool commands', () => {
  it('updates only the installed tools and then has each one install its Skill again', async () => {
    const s = setup();
    const rows = await s.command.execute({
      tools: s.tools,
      all: true,
      update: true,
      dryRun: false,
      posture: writable,
    });
    expect(rows.map((row) => [row.name, row.skill])).toEqual([
      ['alpha', 'installed'],
      ['byhand', 'none'],
    ]);
    expect(s.proc.calledWith(['npm', 'install', '-g', '@example/alpha@latest'])).toBe(true);
    expect(s.proc.calledWith(['npm', 'install', '-g', '@example/beta@latest'])).toBe(false);
    expect(s.proc.calledWith(['alpha', 'skill', 'install', '--dir', skillsDir])).toBe(true);
    // Nothing outside a workspace is "missing": the catalog is only what fx could install.
    expect(s.reporter.codes()).not.toContain('TOOLS_NOT_INSTALLED');
  });

  it('installs the Skill of a tool it just installed, and only plans both in a preview', async () => {
    const s = setup();
    const preview = await s.command.execute({
      tools: s.tools,
      names: ['beta'],
      update: false,
      dryRun: true,
      posture: writable,
    });
    expect(preview).toMatchObject([{ name: 'beta', status: 'planned', skill: 'planned' }]);
    expect(s.proc.calledWith(['npm'])).toBe(false);
    expect(s.proc.calledWith(['beta'])).toBe(false);

    const applied = await s.command.execute({
      tools: s.tools,
      names: ['beta'],
      update: false,
      dryRun: false,
      posture: writable,
    });
    expect(applied).toMatchObject([{ name: 'beta', status: 'done', skill: 'installed' }]);
    expect(s.proc.calledWith(['beta', 'skill', 'install', '--dir', skillsDir])).toBe(true);
  });

  it('leaves the Skill alone when the package operation failed', async () => {
    const s = setup();
    s.proc.override(['npm', 'install', '-g', '@example/alpha@latest'], {
      code: 1,
      stdout: '',
      stderr: 'E404',
    });
    const rows = await s.command.execute({
      tools: s.tools,
      names: ['alpha'],
      update: true,
      dryRun: false,
      posture: writable,
    });
    expect(rows).toMatchObject([{ name: 'alpha', status: 'failed', skill: 'none' }]);
    expect(s.proc.calledWith(['alpha', 'skill'])).toBe(false);
  });

  it('keeps the package results when a Skill command cannot start, and the Skills left behind', async () => {
    const s = setup();
    s.proc.override(
      ['alpha', 'skill'],
      Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }),
    );
    await expect(
      s.command.execute({
        tools: s.tools,
        names: ['alpha', 'beta'],
        update: true,
        dryRun: false,
        posture: writable,
      }),
    ).rejects.toMatchObject({
      partialResult: {
        items: [
          { name: 'alpha', status: 'done', skill: 'failed' },
          { name: 'beta', status: 'done', skill: 'not_started' },
        ],
        has_more: false,
      },
    });
    expect(s.proc.calledWith(['beta', 'skill'])).toBe(false);
  });

  it('in a workspace, names the tools update --all left out and runs no team-written Skill command unapproved', async () => {
    const s = setup(
      'schema_version: 3\ntools:\n  - name: alpha\n    skill: { command: [team, skill], dir_flag: --dir }\n',
    );
    const prompter = new FakePrompter();
    prompter.unavailable = true;
    const rows = await s.command.execute({
      tools: s.tools,
      all: true,
      update: true,
      dryRun: false,
      posture: writable,
      trust: {
        gate: new TrustGate(new FakeTrustStore(), prompter),
        workspace: 'team',
        yes: false,
        posture: writable,
      },
    });
    expect(rows.map((row) => [row.name, row.skill])).toEqual([
      ['alpha', 'blocked'],
      ['byhand', 'none'],
    ]);
    expect(s.proc.calledWith(['alpha', 'team', 'skill'])).toBe(false);
    expect(s.reporter.notices).toContainEqual(
      expect.objectContaining({
        code: 'TOOLS_NOT_INSTALLED',
        message: 'not installed, so not updated: beta',
        nextSteps: ['fx tool install --all --workspace team'],
      }),
    );
  });
});
