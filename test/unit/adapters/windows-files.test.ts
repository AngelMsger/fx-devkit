import { mkdtemp, mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { observeLink } from '../../../src/application/skill/observe.js';
import { pathKey, windowsPathProblem } from '../../../src/domain/path.js';
import { decideLink } from '../../../src/domain/skills/projection.js';

describe('Windows workspace paths', () => {
  it('normalizes local drive names without changing POSIX case semantics', () => {
    expect(pathKey('C:\\Work\\Repo', path.win32)).toBe(pathKey('c:/work/repo', path.win32));
    expect(pathKey('/Work', path.posix)).not.toBe(pathKey('/work', path.posix));
    for (const name of ['C:\\a\\CON.txt', 'C:\\a\\tail.', 'C:\\a\\tail ', '\\\\server\\share\\a'])
      expect(windowsPathProblem(name)).toBeDefined();
    expect(windowsPathProblem('D:\\中文 workspace\\repo')).toBeUndefined();
  });

  it('observes and removes a managed directory link without deleting its target', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'fx-link-'));
    const target = path.join(root, 'source');
    const at = path.join(root, '.agents', 'skills');
    await mkdir(target);
    await writeFile(path.join(target, 'SKILL.md'), 'precious');
    const fs = new NodeFs();
    await fs.link(target, at);
    expect((await lstat(at)).isSymbolicLink()).toBe(true);
    expect(decideLink(await observeLink(fs, at), target, true).action).toBe('unchanged');
    await fs.remove(at);
    expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('precious');
    expect(await fs.exists(at)).toBe(false);
  });
});
