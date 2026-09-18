import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { WritePosture } from '../../../src/application/safety/posture.js';
import { replacementFor } from '../../../src/application/safety/replace-files.js';
import { TrustGate } from '../../../src/application/safety/trust.js';
import { SkillList } from '../../../src/application/skill/list.js';
import { SkillStage } from '../../../src/application/skill/stage.js';
import { Sync } from '../../../src/application/sync/index.js';
import { DevkitError } from '../../../src/domain/errors.js';
import { loadTools } from '../../../src/domain/manifest/loader.js';
import { resolveTools } from '../../../src/domain/toolchain/resolve.js';
import { FakeAgentHost } from '../../fakes/fake-agent-host.js';
import { FakeClock } from '../../fakes/fake-clock.js';
import { FakeLock } from '../../fakes/fake-lock.js';
import { FakePrompter } from '../../fakes/fake-prompter.js';
import { FakeTrustStore } from '../../fakes/fake-trust-store.js';
import { harness, MANIFEST_DIR, ROOT } from '../../fakes/workspace.js';

const writable: WritePosture = { readOnly: false, source: 'default' };
const locked: WritePosture = { readOnly: true, source: 'env' };
const agents = [new FakeAgentHost('claude-code', true), new FakeAgentHost('codex', true)];
const claudeDir = agents[0]!.skillsDir('global');
const codexDir = agents[1]!.skillsDir('global');
const teamSkills = path.join(MANIFEST_DIR, 'skills');
const teamSkill = path.join(teamSkills, 'review');
const claudeLink = agents[0]!.skillsDir('project', ROOT);
const codexLink = agents[1]!.skillsDir('project', ROOT);

const bundledSkill = {
  dir: path.resolve('/pkg/skills/fx-workspace'),
  files: {
    [path.resolve('/pkg/skills/fx-workspace/SKILL.md')]:
      '---\nname: fx-workspace\nversion: 1.0.0\ndescription: x\n---\nbody\n',
    [path.resolve('/pkg/skills/fx-workspace/references/commands.md')]: '# commands\n',
  },
};

async function setup(extra: Record<string, string> = {}) {
  const h = await harness({
    files: {
      [path.join(teamSkill, 'SKILL.md')]: '---\nname: review\n---\n',
      ...bundledSkill.files,
      ...extra,
    },
  });
  const skills = {
    hosts: agents,
    configured: undefined,
    bundledSkillDir: bundledSkill.dir,
    globalLock: new FakeLock(),
  };
  return { h, skills };
}

describe('SkillStage partial execution', () => {
  it('performs no projections, tool calls or global lock acquisition for configured empty selection', async () => {
    const { h, skills } = await setup();
    const before = [...h.fs.writes];
    const stage = new SkillStage(h.deps, {
      ...skills,
      configured: [],
      globalLock: {
        acquire: async () => {
          throw new Error('must not acquire global lock');
        },
      },
    });
    const result = await stage.execute({ dryRun: false, posture: writable });
    expect(result).toMatchObject({ links: [], fx: [], tools: [] });
    expect(h.fs.writes).toEqual(before);
    expect(h.process.calls).toEqual([]);
  });

  it('does not call a missing companion or call its skipped Skill preparation complete', async () => {
    const { h, skills } = await setup();
    const loaded = loadTools(
      'schema_version: 2\ndefaults: {install: [{via: manual}], skill: {command: [skill, install]}}\ntools: [{name: absent}]',
      undefined,
      { cliVersion: '1.0.0' },
    );
    const stage = new SkillStage(h.deps, skills);
    const result = await new Sync(h.deps).execute({
      dryRun: false,
      posture: writable,
      jobs: 1,
      only: 'skills',
      stages: {
        skills: async () => {
          const { summary, ...details } = await stage.execute({
            dryRun: false,
            posture: writable,
            toolchain: resolveTools(loaded.doc, loaded.provenance),
          });
          return { summary, details };
        },
      },
    });
    expect(result.preparation_complete).toBe(false);
    expect(result.stage_details?.skills?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ failure: expect.objectContaining({ code: 'TOOL_MISSING' }) }),
      ]),
    );
  });
  it.each(['PROCESS_ABORTED', 'PROCESS_TIMEOUT', 'INTERNAL'])(
    'preserves completed resources and tool rows on %s',
    async (code) => {
      const { h, skills } = await setup();
      const loaded = loadTools(
        'schema_version: 2\ndefaults: { install: [{via: manual}], skill: { command: [skill, install] } }\ntools: [{name: alpha}, {name: beta}, {name: gamma}]',
        undefined,
        { cliVersion: '1.0.0' },
      );
      const calls: string[] = [];
      const error =
        code === 'INTERNAL'
          ? new TypeError('synthetic failure')
          : new DevkitError('internal', code, 'synthetic failure');
      const deps = {
        ...h.deps,
        processWhich: async () => '/synthetic/bin',
        processRun: async (vector: readonly string[]) => {
          calls.push(vector[0]!);
          if (vector[0] === 'beta') throw error;
          return { code: 0, stdout: '', stderr: '' };
        },
      };
      const stage = new SkillStage(deps, skills);
      await expect(
        new Sync(deps).execute({
          dryRun: false,
          posture: writable,
          jobs: 1,
          only: 'skills',
          stages: {
            skills: async () => {
              const { summary, ...details } = await stage.execute({
                dryRun: false,
                posture: writable,
                toolchain: resolveTools(loaded.doc, loaded.provenance),
              });
              return { summary, details };
            },
            hooks: async () => {
              throw new Error('must not run');
            },
          },
        }),
      ).rejects.toMatchObject({
        code,
        category: 'internal',
        partialResult: {
          stage_details: {
            skills: {
              links: expect.arrayContaining([
                expect.objectContaining({
                  status: 'done',
                  observed: { kind: 'link', target: teamSkills },
                }),
              ]),
              fx: expect.arrayContaining([
                expect.objectContaining({
                  status: 'done',
                  observed: { kind: 'ours', version: '1.0.0' },
                }),
              ]),
              tools: [
                { tool: 'alpha', code: 0, status: 'done' },
                { tool: 'beta', code: null, status: 'failed', failure: { code } },
                { tool: 'gamma', code: null, status: 'not_started' },
              ],
              summary: { tools_run: 1, tools_failed: 1, tools_not_started: 1 },
            },
          },
        },
      });
      expect(calls).toEqual(['alpha', 'beta']);
      expect(await h.fs.readLink(claudeLink)).toBe(teamSkills);
      expect(await h.fs.exists(path.join(claudeDir, 'fx-workspace', 'SKILL.md'))).toBe(true);
    },
  );

  it.each(['link', 'replaceDir'] as const)(
    'retains disk observations when %s throws after writing',
    async (method) => {
      const { h, skills } = await setup();
      const original = h.fs[method].bind(h.fs);
      let calls = 0;
      h.fs[method] = async (from, to) => {
        await original(from, to);
        if (++calls === 1) throw new Error('after write');
      };
      await expect(
        new SkillStage(h.deps, skills).execute({ dryRun: false, posture: writable }),
      ).rejects.toMatchObject({
        code: 'INTERNAL',
        partialResult:
          method === 'link'
            ? {
                links: [
                  { status: 'failed', observed: { kind: 'link', target: teamSkills } },
                  { status: 'not_started' },
                ],
                fx: [{ status: 'not_started' }, { status: 'not_started' }],
              }
            : {
                links: [{ status: 'done' }, { status: 'done' }],
                fx: [
                  { status: 'failed', observed: { kind: 'ours', version: '1.0.0' } },
                  { status: 'not_started' },
                ],
              },
      });
      expect(calls).toBe(1);
    },
  );
});

describe('SkillStage: the team link', () => {
  it('backs up a user Skill directory on approval and never changes it on refusal', async () => {
    const { h, skills } = await setup({ [`${claudeLink}/personal/SKILL.md`]: 'my skill' });
    const prompter = new FakePrompter();
    const replace = replacementFor(h.fs, prompter, h.reporter, false);
    prompter.confirmWith = false;
    await new SkillStage(h.deps, skills).execute({ dryRun: false, posture: writable, replace });
    expect(await h.fs.readText(`${claudeLink}/personal/SKILL.md`)).toBe('my skill');
    prompter.confirmWith = true;
    await new SkillStage(h.deps, skills).execute({ dryRun: false, posture: writable, replace });
    expect(await h.fs.readText(`${claudeLink}.fx-backup/personal/SKILL.md`)).toBe('my skill');
    expect(await h.fs.readLink(claudeLink)).toBe(teamSkills);
  });

  it('links the team Skills directory into every enabled agent at the root, once', async () => {
    const { h, skills } = await setup();
    const first = await new SkillStage(h.deps, skills).execute({
      dryRun: false,
      posture: writable,
    });
    expect(first.links.map((i) => [i.agent, i.path, i.action])).toEqual([
      ['claude-code', claudeLink, 'create'],
      ['codex', codexLink, 'create'],
    ]);
    expect(h.fs.links.get(claudeLink)).toBe(teamSkills);
    const second = await new SkillStage(h.deps, skills).execute({
      dryRun: false,
      posture: writable,
    });
    expect(second.links.every((i) => i.action === 'unchanged')).toBe(true);
    expect(second.summary).toMatchObject({ unchanged: 2, create: 0, install: 0, current: 2 });
  });

  it('prunes an fx link whose source is gone and leaves foreign entries alone with a notice', async () => {
    const h = await harness({ files: bundledSkill.files });
    const skills = {
      hosts: agents,
      configured: undefined,
      bundledSkillDir: bundledSkill.dir,
      globalLock: new FakeLock(),
    };
    await h.fs.link(teamSkills, claudeLink);
    // A per-Skill link is from before team Skills became one link: not fx's.
    await h.fs.link(teamSkill, codexLink);
    const out = await new SkillStage(h.deps, skills).execute({ dryRun: false, posture: writable });
    expect(out.links.map((i) => [i.agent, i.action])).toEqual([
      ['claude-code', 'prune'],
      ['codex', 'foreign'],
    ]);
    expect(h.fs.links.has(claudeLink)).toBe(false);
    expect(h.fs.links.get(codexLink)).toBe(teamSkill);
    expect(h.reporter.codes()).toContain('SKILL_FOREIGN');
  });

  it('keeps a hand-made project Skill directory and says so', async () => {
    const { h, skills } = await setup({
      [path.join(claudeLink, 'mine', 'SKILL.md')]: '---\nname: mine\n---\n',
    });
    const out = await new SkillStage(h.deps, skills).execute({ dryRun: false, posture: writable });
    expect(out.links.map((i) => [i.agent, i.action])).toEqual([
      ['claude-code', 'foreign'],
      ['codex', 'create'],
    ]);
    expect(h.fs.links.has(claudeLink)).toBe(false);
    expect(await h.fs.readText(path.join(claudeLink, 'mine', 'SKILL.md'))).toBe(
      '---\nname: mine\n---\n',
    );
  });

  it('respects --agent, previews under dry-run, and refuses under read-only', async () => {
    const { h, skills } = await setup();
    const only = await new SkillStage(h.deps, skills).execute({
      agents: ['codex'],
      dryRun: true,
      posture: locked,
    });
    expect(only.links.map((i) => i.agent)).toEqual(['codex']);
    expect(h.fs.links.size).toBe(0);
    await expect(
      new SkillStage(h.deps, skills).execute({ dryRun: false, posture: locked }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
  });

  it('gives agents sharing one project directory one link between them', async () => {
    const { h } = await setup();
    const shared = new FakeAgentHost('codex', true);
    shared.skillsDir = (scope, root) =>
      scope === 'global' ? codexDir : path.join(root ?? ROOT, '.agents', 'skills');
    const copilot = new FakeAgentHost('github-copilot', true);
    copilot.skillsDir = shared.skillsDir;
    const out = await new SkillStage(h.deps, {
      hosts: [shared, copilot],
      configured: undefined,
      bundledSkillDir: bundledSkill.dir,
      globalLock: new FakeLock(),
    }).execute({ dryRun: false, posture: writable });
    expect(out.links).toEqual([
      expect.objectContaining({
        agent: 'codex, github-copilot',
        path: path.join(ROOT, '.agents', 'skills'),
        action: 'create',
      }),
    ]);
  });

  it('reports a workspace without a skills directory as nothing to do', async () => {
    const h = await harness();
    const out = await new SkillStage(h.deps, {
      hosts: agents,
      configured: undefined,
      bundledSkillDir: bundledSkill.dir,
      globalLock: new FakeLock(),
    }).execute({ dryRun: false, posture: writable });
    expect(out.links.map((i) => i.action)).toEqual(['skip', 'skip']);
    expect(h.fs.links.size).toBe(0);
  });
});

describe('SkillStage: the fx copy and the tools', () => {
  it('installs by host directories without sending unsupported agent names to companions', async () => {
    const { h, skills } = await setup();
    const cursor = new FakeAgentHost('cursor', true);
    const loaded = loadTools(
      'schema_version: 2\ndefaults: { install: [{ via: manual }], skill: { command: [skill, install], dir_flag: --dir } }\ntools: [{ name: alpha }]',
      undefined,
      { cliVersion: '1.0.0' },
    );
    const toolchain = resolveTools(loaded.doc, loaded.provenance);
    h.process.binaries.add('alpha');
    h.process.always({ code: 0, stdout: '', stderr: '' });
    const stage = new SkillStage(h.deps, { ...skills, hosts: [...agents, cursor] });
    const planned = await stage.execute({ toolchain, dryRun: true, posture: locked });
    expect(planned.tools.map((t) => t.vector)).toEqual(
      [claudeDir, codexDir, cursor.skillsDir('global')].map((dir) => [
        'alpha',
        'skill',
        'install',
        '--dir',
        dir,
      ]),
    );
    const out = await stage.execute({ toolchain, dryRun: false, posture: writable });
    expect(out.tools.map((t) => t.code)).toEqual([0, 0, 0]);
    expect(out.summary).toMatchObject({ tools_run: 3, tools_failed: 0 });
    const empty = await stage.execute({ toolchain, agents: [], dryRun: false, posture: writable });
    expect(empty.tools).toEqual([]);
  });

  it('keeps legacy agent targeting when a patch supplies agent_flag over directory defaults', async () => {
    const { h, skills } = await setup();
    const loaded = loadTools(
      'schema_version: 2\ndefaults: { install: [{ via: manual }], skill: { command: [skill, install], dir_flag: --dir } }\ntools: [{ name: alpha }]',
      'schema_version: 2\ndefaults: { install: [{ via: manual }], skill: { command: [skill, install], agent_flag: --for } }\ntools: [{ name: alpha }]',
      { cliVersion: '1.0.0' },
    );
    h.process.binaries.add('alpha');
    const out = await new SkillStage(h.deps, skills).execute({
      toolchain: resolveTools(loaded.doc, loaded.provenance),
      dryRun: true,
      posture: locked,
    });
    expect(out.tools[0]?.vector).toEqual([
      'alpha',
      'skill',
      'install',
      '--for',
      'claude-code',
      '--for',
      'codex',
    ]);
    expect(out.tools[0]?.origin).toBe('patch');
  });

  it('copies the fx Skill into each agent, upgrades an older copy, keeps a current one', async () => {
    const { h, skills } = await setup({
      [path.join(codexDir, 'fx-workspace', 'SKILL.md')]:
        '---\nname: fx-workspace\nversion: 0.1.0\n---\n',
    });
    const out = await new SkillStage(h.deps, skills).execute({
      dryRun: false,
      posture: writable,
    });
    expect(out.fx.map((i) => [i.agent, i.action])).toEqual([
      ['claude-code', 'install'],
      ['codex', 'upgrade'],
    ]);
    expect(
      await h.fs.readText(path.join(claudeDir, 'fx-workspace', 'references', 'commands.md')),
    ).toBe('# commands\n');
    const again = await new SkillStage(h.deps, skills).execute({
      dryRun: false,
      posture: writable,
    });
    expect(again.fx.every((i) => i.action === 'unchanged')).toBe(true);
    expect(again.summary).toMatchObject({ current: 2, install: 0, upgrade: 0 });
  });

  it('refuses a same-named directory that is not an fx copy', async () => {
    const { h, skills } = await setup({
      [path.join(claudeDir, 'fx-workspace', 'SKILL.md')]: '# somebody else\n',
    });
    const out = await new SkillStage(h.deps, skills).execute({
      dryRun: false,
      posture: writable,
    });
    expect(out.fx.find((i) => i.agent === 'claude-code')).toMatchObject({ action: 'foreign' });
    expect(await h.fs.readText(path.join(claudeDir, 'fx-workspace', 'SKILL.md'))).toBe(
      '# somebody else\n',
    );
  });

  it("runs each installed tool's own skill command for every enabled agent, through the trust gate", async () => {
    const { h, skills } = await setup();
    const loaded = loadTools(
      [
        'schema_version: 2',
        'defaults: { install: [{ via: npm }], skill: { command: [skill, install], agent_flag: --agent } }',
        'tools:',
        '  - name: alpha',
        '  - name: beta',
        '    skill: { command: [] }',
      ].join('\n'),
      'schema_version: 2\ntools: [{ name: alpha, skill: { command: [skill, add], agent_flag: --for } }]',
      { cliVersion: '1.0.0' },
    );
    const tools = resolveTools(loaded.doc, loaded.provenance);
    h.process.binaries.add('alpha').add('beta');
    h.process.always({ code: 0, stdout: '[]', stderr: '' });
    const prompter = new FakePrompter();
    prompter.unavailable = true;
    const gate = new TrustGate(new FakeTrustStore(), prompter, new FakeClock());
    await expect(
      new SkillStage(h.deps, skills).execute({
        toolchain: tools,
        trust: { gate, workspace: 'fx', yes: false, posture: writable },
        dryRun: false,
        posture: writable,
      }),
    ).resolves.toMatchObject({
      summary: { tools_blocked: 1 },
      tools: expect.arrayContaining([
        expect.objectContaining({
          vector: null,
          failure: expect.objectContaining({ code: 'VECTOR_UNTRUSTED' }),
        }),
      ]),
    });
    const out = await new SkillStage(h.deps, skills).execute({
      toolchain: tools,
      trust: { gate, workspace: 'fx', yes: true, posture: writable },
      dryRun: false,
      posture: writable,
    });
    expect(out.tools.map((t) => [t.tool, t.vector, t.code])).toEqual([
      ['alpha', ['alpha', 'skill', 'add', '--for', 'claude-code', '--for', 'codex'], 0],
      ['beta', null, null],
    ]);
    expect(out.summary).toMatchObject({ tools_run: 1, tools_skipped: 1, tools_failed: 0 });

    h.process.clear().always({ code: 1, stdout: '', stderr: 'no such agent' });
    const failed = await new SkillStage(h.deps, skills).execute({
      toolchain: tools,
      trust: { gate, workspace: 'fx', yes: true, posture: writable },
      dryRun: false,
      posture: writable,
    });
    expect(failed.tools[0]).toMatchObject({ code: 1, note: 'no such agent' });
    expect(failed.summary).toMatchObject({ tools_failed: 1 });
    const store = new FakeTrustStore();
    const fresh = new TrustGate(store, prompter, new FakeClock());
    const planned = await new SkillStage(h.deps, skills).execute({
      toolchain: tools,
      trust: { gate: fresh, workspace: 'fx', yes: true, posture: locked },
      dryRun: true,
      posture: locked,
    });
    expect(planned.tools[0]).toMatchObject({ code: null, vector: expect.any(Array) });
    expect(store.entries, 'a dry run trusts nothing').toEqual([]);
    await expect(
      new SkillStage(h.deps, skills).execute({
        toolchain: tools,
        trust: { gate: fresh, workspace: 'fx', yes: true, posture: locked },
        dryRun: false,
        posture: locked,
      }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(store.entries, 'the write gate comes before the trust record').toEqual([]);
  });

  it('refuses an inherited Skill command when the patch replaced its executable', async () => {
    const { h, skills } = await setup();
    const loaded = loadTools(
      [
        'schema_version: 2',
        'defaults: { install: [{ via: npm }], skill: { command: [skill, install] } }',
        'tools: [{ name: alpha }]',
      ].join('\n'),
      'schema_version: 2\ntools: [{ name: alpha, binary: surprise }]',
      { cliVersion: '1.0.0' },
    );
    h.process.binaries.add('surprise');
    h.process.always({ code: 0, stdout: '', stderr: '' });
    const prompter = new FakePrompter();
    prompter.unavailable = true;

    await expect(
      new SkillStage(h.deps, skills).execute({
        toolchain: resolveTools(loaded.doc, loaded.provenance),
        trust: {
          gate: new TrustGate(new FakeTrustStore(), prompter, new FakeClock()),
          workspace: 'fx',
          yes: false,
          posture: writable,
        },
        dryRun: false,
        posture: writable,
      }),
    ).resolves.toMatchObject({
      summary: { tools_blocked: 1 },
      tools: expect.arrayContaining([
        expect.objectContaining({
          vector: null,
          failure: expect.objectContaining({ code: 'VECTOR_UNTRUSTED' }),
        }),
      ]),
    });
    expect(h.process.calls).toEqual([]);
    const background = await new SkillStage(h.deps, skills).execute({
      toolchain: resolveTools(loaded.doc, loaded.provenance),
      trust: {
        gate: new TrustGate(new FakeTrustStore(), prompter, new FakeClock()),
        workspace: 'fx',
        yes: false,
        posture: writable,
      },
      dryRun: false,
      posture: writable,
      background: true,
    });
    expect(background.tools[0]).toMatchObject({ vector: null, note: 'untrusted' });
    expect(h.process.calls).toEqual([]);
    expect(background.fx.every((item) => item.action === 'unchanged')).toBe(true);
  });
});

describe('SkillStage: independent local effects and command trust', () => {
  it('blocks only the untrusted tool while projecting local resources and running approved tools', async () => {
    const { h, skills } = await setup();
    const loaded = loadTools(
      [
        'schema_version: 2',
        'defaults: { install: [{ via: npm }], skill: { command: [skill, install] } }',
        'tools:',
        '  - name: alpha',
        '  - name: gamma',
      ].join('\n'),
      [
        'schema_version: 2',
        'tools:',
        '  - { name: alpha, skill: { command: [skill, add] } }',
        '  - { name: gamma, skill: { command: [skill, add] } }',
      ].join('\n'),
      { cliVersion: '1.0.0' },
    );
    const tools = resolveTools(loaded.doc, loaded.provenance);
    h.process.binaries.add('alpha').add('gamma');
    h.process.always({ code: 0, stdout: '', stderr: '' });
    const store = new FakeTrustStore();
    const prompter = new FakePrompter();
    prompter.unavailable = true;
    const gate = new TrustGate(store, prompter, new FakeClock());
    const alpha = tools.filter((t) => t.name === 'alpha');
    await new SkillStage(h.deps, skills).execute({
      toolchain: alpha,
      trust: { gate, workspace: 'fx', yes: true, posture: writable },
      dryRun: true,
      posture: writable,
    });
    await gate.ensure({
      workspace: 'fx',
      vector: ['alpha', 'skill', 'add'],
      label: 'alpha',
      origin: 'patch',
      yes: true,
      posture: writable,
    });
    h.fs.links.clear();
    await expect(
      new SkillStage(h.deps, skills).execute({
        toolchain: tools,
        trust: { gate, workspace: 'fx', yes: false, posture: writable },
        dryRun: false,
        posture: writable,
      }),
    ).resolves.toMatchObject({
      summary: { tools_blocked: 1 },
      tools: expect.arrayContaining([
        expect.objectContaining({
          vector: null,
          failure: expect.objectContaining({ code: 'VECTOR_UNTRUSTED' }),
        }),
      ]),
    });
    expect(h.fs.links.size, 'owned team links were made').toBe(2);
    expect(await h.fs.exists(path.join(claudeDir, 'fx-workspace')), 'owned fx copy').toBe(true);
    expect(
      h.process.calls.some((c) => c.vector[1] === 'skill'),
      'the approved vector ran',
    ).toBe(true);
    expect(h.process.calls.some((c) => c.vector[0] === 'gamma')).toBe(false);
    expect(store.entries.map((e) => e.label)).toEqual(['alpha']);
  });
});

describe('SkillList', () => {
  it('reports every team Skill through the link of its directory, and the fx copy per agent', async () => {
    const { h, skills } = await setup({
      [path.join(teamSkills, 'triage', 'SKILL.md')]: '---\nname: triage\n---\n',
    });
    await new SkillStage(h.deps, skills).execute({
      agents: ['claude-code'],
      dryRun: false,
      posture: writable,
    });
    const rows = await new SkillList(h.deps, skills).execute({});
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'review',
          kind: 'team',
          source: teamSkill,
          states: { 'claude-code': 'installed', codex: 'missing' },
        }),
        expect.objectContaining({
          name: 'triage',
          kind: 'team',
          states: { 'claude-code': 'installed', codex: 'missing' },
        }),
        expect.objectContaining({
          name: 'fx-workspace',
          kind: 'fx',
          states: { 'claude-code': 'installed', codex: 'missing' },
        }),
      ]),
    );
  });
});

describe('observeLink with a relative target', () => {
  it("resolves it against the link's directory, so a foreign link stays foreign", async () => {
    const { observeLink } = await import('../../../src/application/skill/observe.js');
    const { decideLink } = await import('../../../src/domain/skills/projection.js');
    const { FakeFs } = await import('../../fakes/fake-fs.js');
    const fs = FakeFs.from({});
    await fs.link('../elsewhere/review', path.resolve('/home/me/.claude/skills/review'));
    const observed = await observeLink(fs, path.resolve('/home/me/.claude/skills/review'));
    expect(observed).toEqual({
      kind: 'link',
      target: path.resolve('/home/me/.claude/elsewhere/review'),
    });
    expect(decideLink(observed, path.resolve('/ws/skills/review'), true).action).toBe('foreign');
  });
});
