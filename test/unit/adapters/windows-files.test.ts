import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { observeLink } from '../../../src/application/skill/observe.js';
import { decideLink } from '../../../src/domain/skills/projection.js';
import { tempDir } from '../../temp.js';

describe('Windows workspace paths', () => {
  it('observes and removes a managed directory link without deleting its target', async () => {
    const root = tempDir('fx-link-');
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
