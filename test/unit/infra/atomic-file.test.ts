// Store replacement either publishes a complete private file or leaves the
// existing destination intact, without retaining a temporary after failure.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, it } from 'vitest';

import { writeAtomicFile } from '../../../src/infra/atomic-file.js';
import { tempDir } from '../../temp.js';

it('preserves a destination that cannot be replaced and removes the staged file', async () => {
  const dir = tempDir('fx-atomic-file-');
  const target = path.join(dir, 'state');
  await mkdir(target);
  await writeFile(path.join(target, 'preserved'), 'user data');
  await expect(writeAtomicFile(target, 'replacement', { durable: true })).rejects.toMatchObject({
    code: expect.stringMatching(/^E(ISDIR|PERM)$/),
  });
  expect(await readFile(path.join(target, 'preserved'), 'utf8')).toBe('user data');
  expect(await readdir(dir)).toEqual(['state']);
});
