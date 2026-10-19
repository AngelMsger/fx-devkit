// The FileSystem port, asserted once against the disk and against the fake:
// what an application test learns from FakeFs is what NodeFs does.

import { realpathSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { FileLock } from '../../../src/infra/lock.js';
import type { FileSystem } from '../../../src/ports/fs.js';
import { FakeFs } from '../../fakes/fake-fs.js';
import { tempDir } from '../../temp.js';

interface Subject {
  readonly fs: FileSystem;
  readonly root: string;
}

function onDisk(): Subject {
  // The port answers in real paths, and the system temporary directory may itself be a link.
  const root = realpathSync(tempDir('fs-contract-'));
  return { fs: new NodeFs(new FileLock(tempDir('fs-contract-locks-'))), root };
}

function inMemory(): Subject {
  return { fs: new FakeFs(), root: path.resolve('/fs-contract') };
}

// Something already at a path, and how to tell afterwards that it is still there.
interface Occupant {
  readonly kind: string;
  occupy(fs: FileSystem, at: string): Promise<void>;
  content(fs: FileSystem, at: string): Promise<string | undefined>;
}

async function children(fs: FileSystem, directory: string): Promise<string[]> {
  return (await fs.readDir(directory)).sort();
}

describe.each([
  ['NodeFs', onDisk],
  ['FakeFs', inMemory],
])('%s as a FileSystem', (_, subject) => {
  it('answers for an absent path with a value', async () => {
    const { fs, root } = subject();
    const absent = path.join(root, 'absent');

    expect(await fs.readText(absent)).toBeUndefined();
    expect(await fs.readBytes(absent)).toBeUndefined();
    expect(await fs.readLink(absent)).toBeUndefined();
    expect(await fs.exists(absent)).toBe(false);
    expect(await fs.isDirectory(absent)).toBe(false);
  });

  it('lists an absent directory as empty', async () => {
    const { fs, root } = subject();

    expect(await fs.readDir(path.join(root, 'absent'))).toEqual([]);
  });

  it('fails a read that takes a directory for a file or a file for a directory', async () => {
    const { fs, root } = subject();
    await fs.writeText(path.join(root, 'team', 'guide.md'), 'guide');

    await expect(fs.readText(path.join(root, 'team'))).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(fs.readDir(path.join(root, 'team', 'guide.md'))).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });

  it('lists files, directories and links as the direct children of a directory', async () => {
    const { fs, root } = subject();
    await fs.writeText(path.join(root, 'team', 'guide.md'), 'guide');
    await fs.writeText(path.join(root, 'team', 'review', 'SKILL.md'), 'review');
    await fs.link(path.join(root, 'elsewhere'), path.join(root, 'team', 'shared'));

    expect(await children(fs, path.join(root, 'team'))).toEqual(['guide.md', 'review', 'shared']);
    expect(await fs.isDirectory(path.join(root, 'team', 'review'))).toBe(true);
    expect(await fs.isDirectory(path.join(root, 'team', 'guide.md'))).toBe(false);
    expect(await fs.readLink(path.join(root, 'team', 'guide.md'))).toBeUndefined();
  });

  it('follows a link to a directory when asked about it or reading below it', async () => {
    const { fs, root } = subject();
    const source = path.join(root, 'source', 'review');
    const projected = path.join(root, 'agent', 'skills', 'review');
    await fs.writeText(path.join(source, 'SKILL.md'), 'review');
    await fs.link(source, projected);

    expect(await fs.readLink(projected)).toBe(source);
    expect(await fs.exists(projected)).toBe(true);
    expect(await fs.isDirectory(projected)).toBe(true);
    expect(await children(fs, projected)).toEqual(['SKILL.md']);
    expect(await fs.readText(path.join(projected, 'SKILL.md'))).toBe('review');
    expect(await fs.realpath(path.join(projected, 'SKILL.md'))).toBe(path.join(source, 'SKILL.md'));
  });

  it('records a link target given relative to the working directory as an absolute path', async () => {
    const { fs, root } = subject();
    const source = path.join(root, 'source');
    const projected = path.join(root, 'agent', 'projected');
    await fs.writeText(path.join(source, 'SKILL.md'), 'review');

    await fs.link(path.relative(process.cwd(), source), projected);

    expect(await fs.readLink(projected)).toBe(source);
    expect(await fs.readText(path.join(projected, 'SKILL.md'))).toBe('review');
  });

  it('writes below a linked directory into its target', async () => {
    const { fs, root } = subject();
    const source = path.join(root, 'source');
    const projected = path.join(root, 'projected');
    await fs.ensureDir(source);
    await fs.link(source, projected);

    await fs.writeText(path.join(projected, 'notes.md'), 'through the link');

    expect(await fs.readText(path.join(source, 'notes.md'))).toBe('through the link');
  });

  it('reports a link whose target is gone as a link to nothing', async () => {
    const { fs, root } = subject();
    const gone = path.join(root, 'gone');
    const dangling = path.join(root, 'agent', 'dangling');
    await fs.link(gone, dangling);

    expect(await fs.readLink(dangling)).toBe(gone);
    expect(await fs.exists(dangling)).toBe(false);
    expect(await fs.isDirectory(dangling)).toBe(false);
    expect(await fs.readDir(dangling)).toEqual([]);
    expect(await fs.readText(path.join(dangling, 'SKILL.md'))).toBeUndefined();
    expect(await children(fs, path.join(root, 'agent'))).toEqual(['dangling']);
    expect(await fs.realpath(dangling)).toBe(dangling);
  });

  it('removes a link and leaves what it points at', async () => {
    const { fs, root } = subject();
    const source = path.join(root, 'source');
    const projected = path.join(root, 'projected');
    await fs.writeText(path.join(source, 'SKILL.md'), 'kept');
    await fs.link(source, projected);

    await fs.remove(projected);

    expect(await fs.readLink(projected)).toBeUndefined();
    expect(await fs.exists(projected)).toBe(false);
    expect(await fs.readText(path.join(source, 'SKILL.md'))).toBe('kept');
  });

  it('removes a directory with the links inside it', async () => {
    const { fs, root } = subject();
    const agent = path.join(root, 'agent');
    await fs.writeText(path.join(agent, 'settings.json'), '{}');
    await fs.link(path.join(root, 'source'), path.join(agent, 'skills', 'review'));

    await fs.remove(agent);

    expect(await fs.exists(agent)).toBe(false);
    expect(await fs.readLink(path.join(agent, 'skills', 'review'))).toBeUndefined();
  });

  it.each<Occupant>([
    {
      kind: 'a directory',
      occupy: (fs, at) => fs.writeText(path.join(at, 'own.md'), 'own'),
      content: (fs, at) => fs.readText(path.join(at, 'own.md')),
    },
    {
      kind: 'a file',
      occupy: (fs, at) => fs.writeText(at, 'own'),
      content: (fs, at) => fs.readText(at),
    },
    {
      kind: 'a link',
      occupy: (fs, at) => fs.link(path.join(path.dirname(at), 'other'), at),
      content: (fs, at) => fs.readLink(at),
    },
  ])('refuses to link onto $kind', async ({ occupy, content }) => {
    const { fs, root } = subject();
    const at = path.join(root, 'agent', 'review');
    await occupy(fs, at);
    const before = await content(fs, at);

    await expect(fs.link(path.join(root, 'source'), at)).rejects.toMatchObject({
      code: 'EEXIST',
    });

    expect(before).toBeDefined();
    expect(await content(fs, at)).toBe(before);
  });

  it('refuses to write a document where a directory or a link is', async () => {
    const { fs, root } = subject();
    const directory = path.join(root, 'directory');
    const projected = path.join(root, 'projected');
    await fs.writeText(path.join(directory, 'inside.md'), 'kept');
    await fs.link(directory, projected);

    await expect(fs.writeText(directory, 'document')).rejects.toMatchObject({
      code: 'PROJECTION_FOREIGN',
    });
    await expect(fs.writeText(projected, 'document')).rejects.toMatchObject({
      code: 'PROJECTION_FOREIGN',
    });

    expect(await fs.readText(path.join(directory, 'inside.md'))).toBe('kept');
    expect(await fs.readLink(projected)).toBe(directory);
  });

  it('copies a tree and fails without a destination when the source is absent', async () => {
    const { fs, root } = subject();
    const source = path.join(root, 'source');
    await fs.writeText(path.join(source, 'SKILL.md'), 'review');
    await fs.writeText(path.join(source, 'references', 'rules.md'), 'rules');

    await fs.copyDir(source, path.join(root, 'copy'));
    await expect(
      fs.copyDir(path.join(root, 'absent'), path.join(root, 'never')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    expect(await fs.readText(path.join(root, 'copy', 'references', 'rules.md'))).toBe('rules');
    expect(await children(fs, path.join(root, 'copy'))).toEqual(['SKILL.md', 'references']);
    expect(await fs.exists(path.join(root, 'never'))).toBe(false);
  });

  it('replaces a directory with the source tree, dropping what the source lacks', async () => {
    const { fs, root } = subject();
    const source = path.join(root, 'source');
    const installed = path.join(root, 'installed');
    await fs.writeText(path.join(source, 'new.md'), 'new');
    await fs.writeText(path.join(installed, 'old.md'), 'old');

    await fs.replaceDir(source, installed);

    expect(await children(fs, installed)).toEqual(['new.md']);
    expect(await fs.readText(path.join(source, 'new.md'))).toBe('new');
  });

  it('keeps the installed directory when the replacement source is absent', async () => {
    const { fs, root } = subject();
    const installed = path.join(root, 'installed');
    await fs.writeText(path.join(installed, 'old.md'), 'kept');

    await expect(fs.replaceDir(path.join(root, 'absent'), installed)).rejects.toMatchObject({
      code: 'INTERNAL',
      cause: { code: 'ENOENT' },
    });

    expect(await fs.readText(path.join(installed, 'old.md'))).toBe('kept');
  });

  it('refuses to replace a file or a link with a directory', async () => {
    const { fs, root } = subject();
    const source = path.join(root, 'source');
    const file = path.join(root, 'file');
    const projected = path.join(root, 'projected');
    await fs.writeText(path.join(source, 'new.md'), 'new');
    await fs.writeText(file, 'kept');
    await fs.link(source, projected);

    await expect(fs.replaceDir(source, file)).rejects.toMatchObject({
      code: 'PROJECTION_FOREIGN',
    });
    await expect(fs.replaceDir(source, projected)).rejects.toMatchObject({
      code: 'PROJECTION_FOREIGN',
    });

    expect(await fs.readText(file)).toBe('kept');
    expect(await fs.readLink(projected)).toBe(source);
  });

  it('moves a path aside to the first backup name nothing occupies', async () => {
    const { fs, root } = subject();
    const guide = path.join(root, 'AGENTS.md');
    await fs.writeText(guide, 'first');
    await fs.link(path.join(root, 'gone'), `${guide}.fx-backup-1`);

    const first = await fs.moveToBackup(guide);
    await fs.writeText(guide, 'second');
    const second = await fs.moveToBackup(guide);

    expect([first, second]).toEqual([`${guide}.fx-backup`, `${guide}.fx-backup-2`]);
    expect(await fs.readText(first)).toBe('first');
    expect(await fs.readText(second)).toBe('second');
    expect(await fs.exists(guide)).toBe(false);
  });

  it('moves a directory aside with its content and a link aside as a link', async () => {
    const { fs, root } = subject();
    const directory = path.join(root, 'skills');
    const projected = path.join(root, 'projected');
    await fs.writeText(path.join(directory, 'review', 'SKILL.md'), 'review');
    await fs.link(directory, projected);

    const link = await fs.moveToBackup(projected);
    const moved = await fs.moveToBackup(directory);

    expect(await fs.readText(path.join(moved, 'review', 'SKILL.md'))).toBe('review');
    expect(await fs.exists(directory)).toBe(false);
    expect(await fs.readLink(link)).toBe(directory);
    expect(await fs.readLink(projected)).toBeUndefined();
  });

  it('reports a path that vanished before it could be moved aside', async () => {
    const { fs, root } = subject();
    await fs.ensureDir(root);

    await expect(fs.moveToBackup(path.join(root, 'absent'))).rejects.toMatchObject({
      code: 'PROJECTION_CHANGED',
    });
  });
});
