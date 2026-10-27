import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SkillCopies } from '../../../../src/application/skill/copies.js';
import { StandaloneSkill } from '../../../../src/application/skill/standalone.js';
import { asDevkitError } from '../../../../src/domain/errors.js';
import { FakeAgentHost } from '../../../fakes/fake-agent-host.js';
import { FakeFs } from '../../../fakes/fake-fs.js';
import { FakeLock } from '../../../fakes/fake-lock.js';
import { FakePrompter } from '../../../fakes/fake-prompter.js';

const source = path.resolve('/package/skills/fx-workspace');
const target = path.resolve('/home/skills/fx-workspace');
const text = (version: string) => `---\nname: fx-workspace\nversion: ${version}\n---\n`;
const files = { [path.join(source, 'SKILL.md')]: text('1.0.0') };

describe('shared Skill copy service', () => {
  it.each(['EPERM', 'EACCES'])(
    'reports denied lock access with local recovery: %s',
    async (code) => {
      const fs = FakeFs.from(files);
      const resource = '/home/.fx/locks';
      const copies = new SkillCopies({
        fs,
        version: '1.0.0',
        skills: {
          bundledSkillDir: source,
          globalLock: new FakeLock().onAcquire(() => {
            throw asDevkitError(Object.assign(new Error('denied'), { code, path: resource }));
          }),
        },
      });
      await expect(copies.install(target)).rejects.toMatchObject({
        code: 'SKILL_WRITE_DENIED',
        category: 'permission',
        retryable: false,
        message: expect.stringContaining(resource),
        nextSteps: expect.arrayContaining([expect.stringContaining('--only repos,docs')]),
      });
      expect(fs.writes).toEqual([]);
    },
  );

  it('releases the lease after a denied target write and preserves other failures', async () => {
    class DeniedFs extends FakeFs {
      override async replaceDir(): Promise<void> {
        throw Object.assign(new Error('denied'), { code: 'EACCES', path: target });
      }
    }
    const fs = DeniedFs.from(files);
    const globalLock = new FakeLock();
    const copies = new SkillCopies({
      fs,
      version: '1.0.0',
      skills: { bundledSkillDir: source, globalLock },
    });
    await expect(copies.install(target)).rejects.toMatchObject({ code: 'SKILL_WRITE_DENIED' });
    expect(globalLock.requests).not.toEqual([]);
    expect(globalLock.unreleased()).toEqual([]);
  });
  it('refreshes explicit installs but never downgrades during maintenance', async () => {
    const fs = FakeFs.from({ ...files, [path.join(target, 'SKILL.md')]: text('2.0.0') });
    const copies = new SkillCopies({
      fs,
      version: '1.0.0',
      skills: {
        bundledSkillDir: source,
        globalLock: new FakeLock(),
      },
    });
    expect(await copies.install(target)).toBe('unchanged');
    expect(fs.writes).toEqual([]);
    await copies.install(target, { refresh: true });
    expect(await fs.readText(path.join(target, 'SKILL.md'))).toBe(text('1.0.0'));
  });

  it('rechecks version under the lease and always releases it', async () => {
    const fs = FakeFs.from(files);
    const lock = new FakeLock().onAcquire(async () => {
      await fs.writeText(path.join(target, 'SKILL.md'), text('2.0.0'));
    });
    expect(
      await new SkillCopies({
        fs,
        version: '1.0.0',
        skills: { bundledSkillDir: source, globalLock: lock },
      }).install(target),
    ).toBe('unchanged');
    expect(lock.requests).not.toEqual([]);
    expect(lock.unreleased()).toEqual([]);
    expect(await fs.readText(path.join(target, 'SKILL.md'))).toBe(text('2.0.0'));
  });

  it('reports a busy destination without writing', async () => {
    const fs = FakeFs.from(files);
    const copies = new SkillCopies({
      fs,
      version: '1.0.0',
      skills: {
        bundledSkillDir: source,
        globalLock: new FakeLock().busy(),
      },
    });
    await expect(copies.install(target)).rejects.toMatchObject({ code: 'SKILL_BUSY' });
    expect(fs.writes).toEqual([]);
  });

  it('checks write posture after a concurrent target change', async () => {
    const fs = FakeFs.from({ ...files, [path.join(target, 'SKILL.md')]: text('1.0.0') });
    const copies = new SkillCopies({
      fs,
      version: '1.0.0',
      skills: {
        bundledSkillDir: source,
        globalLock: new FakeLock().onAcquire(async () => {
          await fs.remove(target);
        }),
      },
    });
    await expect(
      copies.install(target, { posture: { readOnly: true, source: 'env' } }),
    ).rejects.toMatchObject({ code: 'READONLY_BLOCKED' });
    expect(await fs.exists(target)).toBe(false);
  });

  it('retains completed, failed and unstarted rows when a later target fails', async () => {
    class BrokenFs extends FakeFs {
      override async replaceDir(from: string, to: string): Promise<void> {
        if (to.includes('second')) throw new Error('write failed');
        return super.replaceDir(from, to);
      }
    }
    const fs = BrokenFs.from(files);
    const service = new StandaloneSkill({
      fs,
      version: '1.0.0',
      prompter: new FakePrompter(),
      replace: async () => false,
      skills: {
        hosts: ['first', 'second', 'third'].map((id) => new FakeAgentHost(id, true)),
        configured: undefined,
        bundledSkillDir: source,
        globalLock: new FakeLock(),
      },
    });
    await expect(
      service.write('install', {
        cwd: '/work',
        dryRun: false,
        posture: { readOnly: false, source: 'default' },
        yes: false,
      }),
    ).rejects.toMatchObject({
      partialResult: {
        items: [
          { status: 'installed', observed: { status: 'installed' } },
          { status: 'failed', observed: { status: 'not_installed' } },
          { status: 'not_started', observed: { status: 'not_installed' } },
        ],
      },
    });
  });

  it('updates only older copies it recognizes, wherever an agent keeps them, and never installs', async () => {
    const copy = (id: string) =>
      path.join(path.resolve('/fake/home'), id, 'skills', 'fx-workspace');
    const fs = FakeFs.from({
      ...files,
      [path.join(copy('older'), 'SKILL.md')]: text('0.9.0'),
      [path.join(copy('current'), 'SKILL.md')]: text('1.0.0'),
      [path.join(copy('newer'), 'SKILL.md')]: text('2.0.0'),
      [path.join(copy('foreign'), 'SKILL.md')]: '---\nname: someone-else\n---\n',
    });
    const service = new StandaloneSkill({
      fs,
      version: '1.0.0',
      prompter: new FakePrompter(),
      replace: async () => false,
      skills: {
        // An agent that is not detected here still keeps the copy an earlier install wrote.
        hosts: ['older', 'current', 'newer', 'foreign', 'absent'].map(
          (id) => new FakeAgentHost(id, id === 'current'),
        ),
        configured: undefined,
        bundledSkillDir: source,
        globalLock: new FakeLock(),
      },
    });
    const rows = await service.write('update', {
      cwd: '/work',
      dryRun: false,
      posture: { readOnly: false, source: 'default' },
      yes: false,
    });
    expect(rows.map((row) => [row.agent, row.action, row.status])).toEqual([
      ['older', 'refresh', 'installed'],
      ['current', 'skip', 'skipped'],
      ['newer', 'skip', 'skipped'],
      ['foreign', 'skip', 'skipped'],
      ['absent', 'skip', 'skipped'],
    ]);
    expect(await fs.readText(path.join(copy('older'), 'SKILL.md'))).toBe(text('1.0.0'));
    expect(await fs.readText(path.join(copy('newer'), 'SKILL.md'))).toBe(text('2.0.0'));
    expect(await fs.exists(copy('absent'))).toBe(false);
  });

  it('decides an update again under the lock, so a copy changed since the plan stays as it is', async () => {
    const copy = path.join(path.resolve('/fake/home'), 'claude', 'skills', 'fx-workspace');
    const skill = path.join(copy, 'SKILL.md');
    const run = async (meanwhile: (fs: FakeFs) => Promise<void>) => {
      const fs = FakeFs.from({ ...files, [skill]: text('0.9.0') });
      const [row] = await new StandaloneSkill({
        fs,
        version: '1.0.0',
        prompter: new FakePrompter(),
        replace: async () => true,
        skills: {
          hosts: [new FakeAgentHost('claude', true)],
          configured: undefined,
          bundledSkillDir: source,
          globalLock: new FakeLock().onAcquire(() => meanwhile(fs)),
        },
      }).write('update', {
        cwd: '/work',
        dryRun: false,
        posture: { readOnly: false, source: 'default' },
        yes: true,
      });
      return { fs, row };
    };

    const newer = await run((fs) => fs.writeText(skill, text('2.0.0')));
    expect(newer.row).toMatchObject({ action: 'refresh', status: 'skipped', version: '2.0.0' });
    expect(await newer.fs.readText(skill)).toBe(text('2.0.0'));

    const removed = await run((fs) => fs.remove(copy));
    expect(removed.row).toMatchObject({ status: 'not_installed', version: null });
    expect(await removed.fs.exists(copy)).toBe(false);

    const foreign = '---\nname: someone-else\n---\n';
    const replaced = await run((fs) => fs.writeText(skill, foreign));
    expect(replaced.row).toMatchObject({ status: 'foreign' });
    expect(await replaced.fs.readText(skill)).toBe(foreign);
  });
});
