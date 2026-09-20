// node:fs behind the FileSystem port, keeping the port's promise that absence
// is a value: a missing file reads as undefined, a missing directory as empty,
// a path that is no link as no link. Every write makes its parent directory
// first. Anything else propagates.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { asDevkitError, busyError, DevkitError } from '../../domain/errors.js';
import { pathKey } from '../../domain/path.js';
import type { FileSystem } from '../../ports/fs.js';
import type { Lock } from '../../ports/lock.js';

import { replaceDirectory } from './directory-replacement.js';

export class NodeFs implements FileSystem {
  constructor(private readonly lock?: Lock) {}
  async readBytes(file: string): Promise<Uint8Array | undefined> {
    try {
      return await fs.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async writeBytes(file: string, bytes: Uint8Array, executable = false): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, { mode: executable ? 0o755 : 0o644 });
  }

  async readText(file: string): Promise<string | undefined> {
    try {
      return await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async writeText(file: string, text: string): Promise<void> {
    const lease = await this.lock?.acquire({
      key: `projection:${pathKey(file)}`,
      waitMs: 2000,
    });
    if (lease === null) throw busyError('LOCK_BUSY', 'The projection');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const current = await fs.lstat(file).catch((err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw err;
      });
      if (current && !current.isFile())
        throw new DevkitError(
          'conflict',
          'PROJECTION_FOREIGN',
          'The projection is not a regular file',
          { nextSteps: [`Remove or rename ${file}, then re-run the same command.`] },
        );
      await fs.writeFile(temporary, text, {
        flag: 'wx',
        mode: current === undefined ? 0o600 : current.mode & 0o777,
      });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
      await lease?.release();
    }
  }

  async replaceDir(from: string, to: string): Promise<void> {
    if (!this.lock)
      throw new DevkitError(
        'internal',
        'LOCK_UNAVAILABLE',
        'Directory replacement requires a lock',
      );
    const lease = await this.lock.acquire({ key: `projection:${pathKey(to)}`, waitMs: 2000 });
    if (!lease) throw busyError('LOCK_BUSY', 'The Skill projection');
    try {
      const current = await fs.lstat(to).catch((err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw err;
      });
      if (current && !current.isDirectory())
        throw new DevkitError(
          'conflict',
          'PROJECTION_FOREIGN',
          'The projection is not a directory',
          { nextSteps: [`Remove or rename ${to}, then re-run the same command.`] },
        );
      await replaceDirectory(from, to);
    } catch (err) {
      throw asDevkitError(err);
    } finally {
      await lease.release();
    }
  }

  async moveToBackup(target: string): Promise<string> {
    if (!this.lock)
      throw new DevkitError('internal', 'LOCK_UNAVAILABLE', 'Path replacement requires a lock');
    const requested = path.resolve(target);
    const parent = await fs.realpath(path.dirname(requested));
    const file = path.join(parent, path.basename(requested));
    const lease = await this.lock.acquire({ key: `projection:${pathKey(file)}`, waitMs: 2000 });
    if (!lease) throw busyError('LOCK_BUSY', 'The replacement');
    try {
      await assertBackupParent(requested, parent);
      const current = await fs.lstat(file);
      if (!current.isFile() && !current.isDirectory() && !current.isSymbolicLink())
        throw new DevkitError('conflict', 'PROJECTION_FOREIGN', 'The path cannot be backed up', {
          nextSteps: [`Inspect ${file} and move it aside before retrying.`],
        });
      for (let suffix = 0; ; suffix += 1) {
        const backup = `${file}.fx-backup${suffix === 0 ? '' : `-${suffix}`}`;
        const backupLease = await this.lock.acquire({
          key: `projection:${pathKey(backup)}`,
          waitMs: 0,
        });
        if (!backupLease) throw busyError('LOCK_BUSY', 'The backup');
        try {
          if (await fs.lstat(backup).then(() => true, missingPath)) continue;
          await assertBackupParent(requested, parent);
          // The move preserves saves through an open file handle; a later editor
          // replacement at the original path is left for the caller to recheck.
          await fs.rename(file, backup);
          return backup;
        } finally {
          await backupLease.release();
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        throw new DevkitError('conflict', 'PROJECTION_CHANGED', 'The replacement path changed', {
          nextSteps: [`Inspect ${file} and retry from its current state.`],
          cause: err,
        });
      throw asDevkitError(err);
    } finally {
      await lease.release();
    }
  }

  async exists(file: string): Promise<boolean> {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  async readDir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async isDirectory(dir: string): Promise<boolean> {
    try {
      return (await fs.stat(dir)).isDirectory();
    } catch {
      return false;
    }
  }

  async readLink(file: string): Promise<string | undefined> {
    try {
      return await fs.readlink(file);
    } catch {
      return undefined;
    }
  }

  async link(target: string, at: string): Promise<void> {
    await fs.mkdir(path.dirname(at), { recursive: true });
    await fs.symlink(path.resolve(target), at, process.platform === 'win32' ? 'junction' : 'dir');
  }

  async copyDir(from: string, to: string): Promise<void> {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.cp(from, to, { recursive: true });
  }

  async remove(file: string): Promise<void> {
    const stat = await fs.lstat(file).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
      return undefined;
    });
    if (stat?.isSymbolicLink()) {
      await fs.unlink(file);
      return;
    }
    await fs.rm(file, { recursive: true, force: true });
  }

  async realpath(target: string): Promise<string> {
    try {
      return await fs.realpath(target);
    } catch {
      const absolute = path.resolve(target);
      const parent = path.dirname(absolute);
      return parent === absolute
        ? absolute
        : path.join(await this.realpath(parent), path.basename(absolute));
    }
  }
}

function missingPath(error: unknown): false {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
  throw error;
}

async function assertBackupParent(file: string, parent: string): Promise<void> {
  if ((await fs.realpath(path.dirname(file))) !== parent)
    throw new DevkitError('conflict', 'PROJECTION_CHANGED', 'The replacement directory changed', {
      nextSteps: [`Inspect the directory containing ${file}, then retry.`],
    });
}
