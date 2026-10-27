import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  StandaloneInit,
  type StandaloneInitInput,
} from '../../../../src/application/init/standalone.js';
import type { WritePosture } from '../../../../src/application/safety/posture.js';
import { ToolInstall } from '../../../../src/application/tool/install.js';
import { DevkitError } from '../../../../src/domain/errors.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeInstaller } from '../../../fakes/fake-installer.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakeProcess } from '../../../fakes/fake-process.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';
import { FakeReporter } from '../../../fakes/fake-reporter.js';
import { fakeToolAudit } from '../../../fakes/fake-tool-history.js';

const catalog = [
  'schema_version: 3',
  'defaults:',
  '  install: [{ via: npm }]',
  '  npm_scope: "@example"',
  '  skill: { command: [skill, install], dir_flag: --dir }',
  '  auth: { command: [auth, status], json: { path: configured, equals: true }, login: [config, init] }',
  'tools:',
  '  - { name: alpha, desc: Alpha service }',
  '  - { name: beta, desc: Beta service }',
  '  - name: byhand',
  '    install: [{ via: manual }]',
  '    skill: { command: [] }',
  '    auth: { command: [] }',
].join('\n');

const writable: WritePosture = { readOnly: false, source: 'default' };
const agent = new FakeAgentHost('claude-code', true);
const skillsDir = agent.skillsDir('global');
const bundledSkill = path.resolve('/pkg/skills/fx-workspace');

function setup(signedIn: readonly string[] = []) {
  const proc = new FakeProcess();
  proc.binaries.add('alpha');
  proc
    .on(['npm', 'install', '-g'], (vector) => {
      proc.binaries.add(vector[3]!.replace(/^@example\/|@latest$/g, ''));
      return { code: 0, stdout: '', stderr: '' };
    })
    .when(
      (vector) => vector[1] === '--version',
      (vector) => ({ code: 0, stdout: `${vector[0]} 1.0.0\n`, stderr: '' }),
    )
    .when(
      (vector) => vector[1] === 'auth',
      (vector) => ({
        code: 0,
        stdout: JSON.stringify({ configured: signedIn.includes(vector[0]!) }),
        stderr: '',
      }),
    )
    .always({ code: 0, stdout: '', stderr: '' });
  const prompter = new FakePrompter();
  const init = new StandaloneInit({
    bundledTools: () => catalog,
    cliVersion: '1.0.0',
    fs: FakeFs.from({
      [path.join(bundledSkill, 'SKILL.md')]: '---\nname: fx-workspace\nversion: 1.0.0\n---\n',
    }),
    process: proc,
    prompter,
    reporter: new FakeReporter(),
    toolInstall: new ToolInstall({
      installers: FakeInstaller.family(['npm']),
      process: proc,
      audit: fakeToolAudit(),
    }),
    skills: {
      hosts: [agent],
      configured: undefined,
      bundledSkillDir: bundledSkill,
      globalLock: new FakeLock(),
    },
  });
  const input: StandaloneInitInput = {
    tools: ['alpha', 'beta'],
    interactive: false,
    yes: false,
    dryRun: false,
    posture: writable,
    cwd: path.resolve('/work'),
  };
  return { proc, prompter, init, input };
}

describe('init without a manifest', () => {
  it('installs what is missing, has each tool install its Skill, and hands over the sign-in still missing', async () => {
    const s = setup(['alpha']);
    const result = await s.init.execute(s.input);
    expect(s.proc.callsTo(['npm', 'install', '-g'])).toHaveLength(1);
    expect(s.proc.calledWith(['npm', 'install', '-g', '@example/beta@latest'])).toBe(true);
    for (const tool of ['alpha', 'beta'])
      expect(s.proc.calledWith([tool, 'skill', 'install', '--dir', skillsDir])).toBe(true);
    expect(result.skills.fx).toMatchObject([{ agent: 'claude-code', status: 'done' }]);
    expect(result.tools).toMatchObject([
      { name: 'alpha', install: 'present', skill: 'installed', sign_in: 'ready' },
      { name: 'beta', install: 'installed', skill: 'installed', sign_in: 'pending' },
    ]);
    expect(result.preparation).toMatchObject({
      state: 'incomplete',
      scope: { workspace: null, tools: ['alpha', 'beta'] },
      blockers: [
        {
          id: 'login:beta.auth',
          owner: 'user',
          actions: [{ actor: 'user', argv: ['beta', 'config', 'init'] }],
        },
      ],
      resume: { argv: ['fx', 'init', '--tools', 'alpha,beta'] },
    });
    expect(s.prompter.questions).toEqual([]);
  });

  it('starts a tool’s own setup on the terminal only when the person says yes, and checks again', async () => {
    const s = setup();
    s.proc.override(['alpha', 'config', 'init'], () => {
      s.proc.override(['alpha', 'auth'], { code: 0, stdout: '{"configured":true}', stderr: '' });
      return { code: 0, stdout: '', stderr: '' };
    });
    const result = await s.init.execute({ ...s.input, tools: ['alpha'], interactive: true });
    expect(s.prompter.questions).toEqual([expect.stringContaining('`alpha config init`')]);
    expect(s.proc.soleCallTo(['alpha', 'config', 'init']).options.interactive).toBe(true);
    expect(result.tools).toMatchObject([{ name: 'alpha', sign_in: 'ready' }]);
    expect(result.preparation.state).toBe('ready');

    const declined = setup();
    declined.prompter.confirmWith = false;
    await declined.init.execute({ ...declined.input, interactive: true });
    expect(declined.prompter.questions).toHaveLength(2);
    expect(declined.proc.calledWith(['alpha', 'config', 'init'])).toBe(false);

    const assumed = setup();
    const handed = await assumed.init.execute({ ...assumed.input, interactive: true, yes: true });
    expect(assumed.prompter.questions).toEqual([]);
    expect(assumed.proc.calledWith(['alpha', 'config', 'init'])).toBe(false);
    expect(handed.preparation.state).toBe('incomplete');
  });

  it('asks a person which tools to set up and needs names from anyone else', async () => {
    const s = setup();
    s.prompter.answers = ['2, alpha'];
    const picked = await s.init.execute({ ...s.input, tools: undefined, interactive: true });
    expect(s.prompter.questions[0]).toContain('  2  beta');
    expect(picked.tools.map((tool) => tool.name)).toEqual(['alpha', 'beta']);

    const every = setup();
    every.prompter.answers = [''];
    every.prompter.confirmWith = false;
    const all = await every.init.execute({ ...every.input, tools: undefined, interactive: true });
    expect(all.tools.map((tool) => tool.name)).toEqual(['alpha', 'beta', 'byhand']);
    expect(all.preparation.blockers.map((check) => check.id)).toContain('tool:byhand');

    await expect(setup().init.execute({ ...s.input, tools: undefined })).rejects.toMatchObject({
      code: 'INIT_INPUT_REQUIRED',
    });
    await expect(setup().init.execute({ ...s.input, tools: ['alpah'] })).rejects.toMatchObject({
      code: 'TOOL_UNKNOWN',
      hint: expect.stringContaining('alpha'),
    });
  });

  it('previews installs and Skills without running them', async () => {
    const s = setup();
    const result = await s.init.execute({ ...s.input, dryRun: true });
    expect(s.proc.calledWith(['npm'])).toBe(false);
    expect(s.proc.calledWith(['beta'])).toBe(false);
    expect(s.proc.calledWith(['alpha', 'skill'])).toBe(false);
    expect(result.tool_install).toMatchObject([
      { name: 'beta', vector: ['npm', 'install', '-g', '@example/beta@latest'] },
    ]);
    expect(result.skills.tools.map((item) => item.vector)).toEqual([
      ['alpha', 'skill', 'install', '--dir', skillsDir],
      ['beta', 'skill', 'install', '--dir', skillsDir],
    ]);
    expect(result.preparation.state).toBe('planned');
  });

  it('keeps installing the other tools when one cannot be installed', async () => {
    const s = setup(['beta']);
    s.proc.binaries.delete('alpha');
    s.proc.override(['npm', 'install', '-g', '@example/alpha@latest'], {
      code: 1,
      stdout: '',
      stderr: 'E404 not found',
    });
    const result = await s.init.execute(s.input);
    expect(result.tools).toMatchObject([
      { name: 'alpha', install: 'failed', state: 'missing', skill: 'none' },
      { name: 'beta', install: 'installed', sign_in: 'ready' },
    ]);
    expect(result.preparation.blockers).toMatchObject([
      { id: 'tool:alpha', message: 'alpha is not installed: E404 not found' },
    ]);

    const interrupted = setup();
    interrupted.proc.override(['npm'], new DevkitError('internal', 'PROCESS_ABORTED', 'stop'));
    await expect(interrupted.init.execute(interrupted.input)).rejects.toMatchObject({
      code: 'PROCESS_ABORTED',
    });
  });
});
