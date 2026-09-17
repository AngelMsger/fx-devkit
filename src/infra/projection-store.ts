// Managed projection writes use same-directory replacement after a locked
// re-read. Symlinked ancestors are foreign, so a project entry cannot redirect
// a write into an unrelated tree. No copy of a user's document enters FX_HOME.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { asDevkitError } from '../domain/errors.js';
import { isAtOrInside, pathKey, samePath } from '../domain/path.js';
import type { Lock } from '../ports/lock.js';
import type {
  LinkProjectionStore,
  LinkProjectionSnapshot,
  LinkProjectionWrite,
  ProjectionPath,
  ProjectionSnapshot,
  ProjectionStore,
  ProjectionWrite,
} from '../ports/projection.js';

export class FileProjectionStore implements ProjectionStore, LinkProjectionStore {
  constructor(private readonly lock: Lock) {}

  async read(at: ProjectionPath): Promise<ProjectionSnapshot> {
    const file = path.resolve(at.root, at.relative);
    if (!(await isSafe(at))) return { kind: 'foreign', text: null };
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.nlink !== 1) return { kind: 'foreign', text: null };
      return { kind: 'file', text: await fs.readFile(file, 'utf8') };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent', text: null };
      throw asDevkitError(err);
    }
  }

  async readLink(at: ProjectionPath): Promise<LinkProjectionSnapshot> {
    if (!(await isSafe(at))) return { kind: 'unsafe', target: null };
    try {
      const file = path.resolve(at.root, at.relative);
      const stat = await fs.lstat(file);
      return stat.isSymbolicLink()
        ? { kind: 'link', target: await fs.readlink(file) }
        : { kind: 'foreign', target: null };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent', target: null };
      throw asDevkitError(err);
    }
  }

  async writeLink(
    input: LinkProjectionWrite,
  ): Promise<'written' | 'unchanged' | 'conflict' | 'busy'> {
    if (input.before.kind !== 'link') return 'conflict';
    const file = path.resolve(input.root, input.relative);
    const lease = await this.lock.acquire({ key: `projection:${pathKey(file)}`, waitMs: 0 });
    if (!lease) return 'busy';
    try {
      const current = await this.readLink(input);
      if (current.kind !== input.before.kind || current.target !== input.before.target)
        return 'conflict';
      if (current.target === input.target) return 'unchanged';
      if (input.target === null) await fs.unlink(file);
      else await replaceLink(file, input.target);
      return 'written';
    } catch (err) {
      throw asDevkitError(err);
    } finally {
      await lease.release();
    }
  }

  async write(input: ProjectionWrite): Promise<'written' | 'unchanged' | 'conflict' | 'busy'> {
    if (input.before.kind === 'foreign') return 'conflict';
    if (input.before.text === input.text) return 'unchanged';
    const file = path.resolve(input.root, input.relative);
    const lease = await this.lock.acquire({ key: `projection:${pathKey(file)}`, waitMs: 0 });
    if (!lease) return 'busy';
    try {
      const current = await this.read(input);
      if (current.kind !== input.before.kind || current.text !== input.before.text)
        return 'conflict';
      if (input.text === null) await fs.unlink(file);
      else await replace(file, input.text);
      return 'written';
    } catch (err) {
      throw asDevkitError(err);
    } finally {
      await lease.release();
    }
  }
}

async function isSafe(at: ProjectionPath): Promise<boolean> {
  const root = path.resolve(at.root);
  const file = path.resolve(root, at.relative);
  if (samePath(file, root) || !isAtOrInside(file, root)) return false;
  let parent = path.dirname(file);
  while (parent !== path.dirname(root)) {
    try {
      const stat = await fs.lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return false;
    }
    parent = path.dirname(parent);
  }
  return true;
}

async function replace(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const mode = await fs.stat(file).then(
      (stat) => stat.mode & 0o777,
      () => 0o600,
    );
    await fs.writeFile(temporary, text, { flag: 'wx', mode });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function replaceLink(file: string, target: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.symlink(
      path.resolve(target),
      temporary,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
