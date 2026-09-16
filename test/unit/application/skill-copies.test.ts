import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SkillCopies } from '../../../src/application/skill/copies.js';
import { StandaloneSkill } from '../../../src/application/skill/standalone.js';
import type { Lock } from '../../../src/ports/lock.js';
import { FakeAgentHost } from '../../fakes/fake-agent-host.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { FakePrompter } from '../../fakes/fake-prompter.js';

const source = path.resolve('/package/skills/fx-workspace');
const target = path.resolve('/home/skills/fx-workspace');
const text = (version: string) => `---\nname: fx-workspace\nversion: ${version}\n---\n`;
const files = { [path.join(source, 'SKILL.md')]: text('1.0.0') };

describe('shared Skill copy service', () => {
  it('refreshes explicit installs but never downgrades during maintenance', async () => {
    const fs = FakeFs.from({ ...files, [path.join(target, 'SKILL.md')]: text('2.0.0') });
    const copies = new SkillCopies(fs, '1.0.0', { bundledSkillDir: source });
    expect(await copies.install(target)).toBe('unchanged');
    expect(fs.writes).toEqual([]);
    await copies.install(target, { refresh: true });
    expect(await fs.readText(path.join(target, 'SKILL.md'))).toBe(text('1.0.0'));
  });

  it('rechecks version under the lease and always releases it', async () => {
    const fs = FakeFs.from(files);
    let released = false;
    const lock: Lock = {
      acquire: async () => {
        await fs.writeText(path.join(target, 'SKILL.md'), text('2.0.0'));
        return {
          release: async () => {
            released = true;
          },
        };
      },
    };
    expect(
      await new SkillCopies(fs, '1.0.0', { bundledSkillDir: source, globalLock: lock }).install(
        target,
      ),
    ).toBe('unchanged');
    expect(released).toBe(true);
    expect(await fs.readText(path.join(target, 'SKILL.md'))).toBe(text('2.0.0'));
  });

  it('reports a busy destination without writing', async () => {
    const fs = FakeFs.from(files);
    const copies = new SkillCopies(fs, '1.0.0', {
      bundledSkillDir: source,
      globalLock: { acquire: async () => null },
    });
    await expect(copies.install(target)).rejects.toMatchObject({ code: 'SKILL_BUSY' });
    expect(fs.writes).toEqual([]);
  });

  it('checks write posture after a concurrent target change', async () => {
    const fs = FakeFs.from({ ...files, [path.join(target, 'SKILL.md')]: text('1.0.0') });
    const copies = new SkillCopies(fs, '1.0.0', {
      bundledSkillDir: source,
      globalLock: {
        acquire: async () => {
          await fs.remove(target);
          return { release: async () => undefined };
        },
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
