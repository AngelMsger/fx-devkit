// Link cases require a POSIX host; junction behavior has native Windows coverage.
import { existsSync } from 'node:fs';
import { link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileLock } from '../../../src/infra/lock.js';
import { OwnedJournal } from '../../../src/infra/owned-journal.js';
import { tempDir } from '../../temp.js';

interface Notes {
  readonly notes: readonly string[];
}

function fixture() {
  const home = tempDir('fx-owned-journal-');
  const file = path.join(home, 'workspaces/test/notes.json');
  const lock = new FileLock(home);
  const lease = { key: 'notes:test', waitMs: 0 };
  const journal = new OwnedJournal<Notes>({
    home,
    file,
    lock,
    lease,
    encode: (value) => {
      if (value.notes.some((note) => note === '')) throw new Error('empty note');
      return JSON.stringify(value);
    },
    decode: (document) => {
      const notes = (document as Partial<Notes>).notes;
      if (!Array.isArray(notes)) throw new Error('not a notes journal');
      return { notes };
    },
    invalid: () => new Error('invalid journal'),
    busy: () => new Error('busy journal'),
  });
  return { home, file, lock, lease, journal };
}

describe('owned journal', () => {
  it('refuses a value outside the contract before creating anything', async () => {
    const f = fixture();
    await expect(f.journal.replace({ notes: [''] })).rejects.toThrow('invalid journal');
    expect(existsSync(path.join(f.home, 'workspaces'))).toBe(false);
    expect(existsSync(path.join(f.home, 'locks'))).toBe(false);
    expect(await f.journal.read()).toBeUndefined();
  });

  it('derives an update from the journal on disk and replaces it under the lease', async () => {
    const f = fixture();
    await f.journal.replace({ notes: ['one'] });
    await f.journal.update((current) => ({ notes: [...(current?.notes ?? []), 'two'] }));
    expect(await f.journal.read()).toEqual({ notes: ['one', 'two'] });

    const held = await f.lock.acquire(f.lease);
    await expect(f.journal.replace({ notes: [] })).rejects.toThrow('busy journal');
    await held?.release();
    expect(await f.journal.read()).toEqual({ notes: ['one', 'two'] });
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a journal with a second link without replacing it',
    async () => {
      const f = fixture();
      await f.journal.replace({ notes: ['one'] });
      const alias = path.join(f.home, 'alias.json');
      await link(f.file, alias);
      await expect(f.journal.read()).rejects.toThrow('invalid journal');
      await expect(f.journal.replace({ notes: [] })).rejects.toThrow('invalid journal');
      expect(JSON.parse(await readFile(alias, 'utf8'))).toEqual({ notes: ['one'] });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'refuses to read or write through a linked directory below the home',
    async () => {
      const f = fixture();
      const elsewhere = tempDir('fx-owned-journal-elsewhere-');
      await mkdir(path.join(elsewhere, 'test'));
      await writeFile(path.join(elsewhere, 'test/notes.json'), JSON.stringify({ notes: ['x'] }));
      await symlink(elsewhere, path.join(f.home, 'workspaces'), 'dir');
      await expect(f.journal.read()).rejects.toThrow('invalid journal');
      await expect(f.journal.replace({ notes: [] })).rejects.toThrow('invalid journal');
      expect(JSON.parse(await readFile(path.join(elsewhere, 'test/notes.json'), 'utf8'))).toEqual({
        notes: ['x'],
      });
    },
  );
});
