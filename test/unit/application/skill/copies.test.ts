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
});
