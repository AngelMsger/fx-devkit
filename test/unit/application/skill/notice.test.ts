import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { skillNotice } from '../../../../src/application/skill/notice.js';
import type { SkillDeps } from '../../../../src/application/skill/targets.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLock } from '../../../fakes/fake-lock.js';

const agents = [new FakeAgentHost('claude-code', true), new FakeAgentHost('codex', true)];
const skills: SkillDeps = {
  hosts: agents,
  configured: undefined,
  bundledSkillDir: path.resolve('/pkg/skills/fx-workspace'),
  globalLock: new FakeLock(),
};
const dir = (id: string): string =>
  path.join(agents.find((a) => a.id === id)!.skillsDir('global'), 'fx-workspace', 'SKILL.md');
const skill = (version: string): string => `---\nname: fx-workspace\nversion: ${version}\n---\n`;
const ask = { format: 'json' as const, loaded: false, enabled: true, cliVersion: '1.2.0' };

describe('skillNotice', () => {
  it('tells an agent the Skill is missing, outdated, or merely not loaded', async () => {
    const none = FakeFs.from({});
    expect((await skillNotice(none, skills, ask))?.code).toBe('SKILL_MISSING');
    const old = FakeFs.from({
      [dir('claude-code')]: skill('1.1.0'),
      [dir('codex')]: skill('1.2.0'),
    });
    expect((await skillNotice(old, skills, ask))?.code).toBe('SKILL_OUTDATED');
    const current = FakeFs.from({
      [dir('claude-code')]: skill('1.2.0'),
      [dir('codex')]: skill('1.2.0'),
    });
    const notice = await skillNotice(current, skills, ask);
    expect(notice?.code).toBe('SKILL_AVAILABLE');
    expect(notice?.nextSteps?.join(' ')).toContain('FX_SKILL_VERSION=1.2.0');
    expect(notice?.silence).toContain('skill_notice');
    const partly = FakeFs.from({ [dir('claude-code')]: skill('1.2.0') });
    expect((await skillNotice(partly, skills, ask))?.code, 'one agent without it is missing').toBe(
      'SKILL_MISSING',
    );
  });

  it('says nothing to a person, to an agent that loaded it, or when silenced; offers bootstrap without detected agents', async () => {
    const none = FakeFs.from({});
    expect(await skillNotice(none, skills, { ...ask, format: 'human' })).toBeUndefined();
    expect(await skillNotice(none, skills, { ...ask, terminal: true })).toBeUndefined();
    expect(
      await skillNotice(none, skills, { ...ask, format: 'human', terminal: false }),
    ).toMatchObject({ code: 'SKILL_MISSING' });
    expect(await skillNotice(none, skills, { ...ask, loaded: true })).toMatchObject({
      code: 'SKILL_VERSION_UNVERIFIED',
    });
    expect(await skillNotice(none, skills, { ...ask, loadedVersion: '1.2.0' })).toBeUndefined();
    expect(await skillNotice(none, skills, { ...ask, loadedVersion: '1.1.0' })).toMatchObject({
      code: 'SKILL_VERSION_MISMATCH',
      data: {
        bundled_skill: path.join(skills.bundledSkillDir, 'SKILL.md'),
        loaded_version: '1.1.0',
      },
    });
    expect(await skillNotice(none, skills, { ...ask, enabled: false })).toBeUndefined();
    const nobody: SkillDeps = { ...skills, hosts: [new FakeAgentHost('cursor', false)] };
    expect(await skillNotice(none, nobody, ask)).toMatchObject({
      code: 'SKILL_MISSING',
      nextSteps: expect.arrayContaining([expect.stringContaining('fx skill show')]),
    });
  });
});
