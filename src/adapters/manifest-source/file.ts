// Directory sources carry the same manifest, prose, docs and Skills as Git
// sources. Only distributable paths are mirrored; replacements need approval.

import path from 'node:path';

import { DevkitError } from '../../domain/errors.js';
import { MANIFEST_DIR } from '../../domain/manifest/files.js';
import { isAtOrInside, samePath } from '../../domain/path.js';
import type { FileSystem } from '../../ports/fs.js';
import type { ManifestSource, ManifestSourceInspection } from '../../ports/manifest-source.js';
import type { ReplaceFiles } from '../../ports/replace-files.js';

import { PAYLOAD_PATHS, preparePayload } from './payload.js';

export class FileSource implements ManifestSource {
  readonly kind = 'file';

  constructor(
    private readonly dir: string,
    private readonly fs: FileSystem,
    private readonly replace?: ReplaceFiles,
  ) {}

  get description(): string {
    return path.resolve(this.dir);
  }

  async inspect(): Promise<ManifestSourceInspection> {
    const from = await this.sourceRoot();
    const sourcePath = (name: string): string =>
      path.join(from.root, from.flat && name.startsWith('manifest/') ? name.slice(9) : name);
    for (const name of PAYLOAD_PATHS) await this.validateTree(sourcePath(name));
    return { root: from.root, readText: (name) => this.fs.readText(sourcePath(name)) };
  }

  async materialize(dir: string): Promise<void> {
    const from = await this.sourceRoot();
    const sourcePath = await this.fs.realpath(from.root);
    const targetPath = await this.fs.realpath(dir);
    if (
      !samePath(sourcePath, targetPath) &&
      (isAtOrInside(sourcePath, targetPath) || isAtOrInside(targetPath, sourcePath))
    )
      throw new DevkitError(
        'conflict',
        'MANIFEST_SOURCE_INVALID',
        'Source and destination directories must not contain one another',
        { nextSteps: [`Choose a destination outside ${sourcePath}, then retry.`] },
      );
    for (const target of [dir, path.join(dir, MANIFEST_DIR)]) {
      if ((await this.fs.readLink(target)) !== undefined)
        throw new DevkitError(
          'conflict',
          'MANIFEST_REPLACE_REQUIRED',
          `Source destination must not redirect through a symbolic link: ${target}`,
          { nextSteps: [`Remove the symbolic link at ${target}, then retry.`] },
        );
    }
    const entries = PAYLOAD_PATHS.map((name) => ({
      name,
      from: path.join(from.root, from.flat && name.startsWith('manifest/') ? name.slice(9) : name),
    }));
    const changed: typeof entries = [];
    for (const entry of entries) {
      await this.validateTree(entry.from);
      if (!(await this.same(entry.from, path.join(dir, entry.name)))) changed.push(entry);
    }
    await preparePayload(
      this.fs,
      dir,
      changed.map((entry) => entry.name),
      this.replace,
    );
    for (const entry of changed) {
      if (await this.fs.exists(entry.from))
        await this.fs.copyDir(entry.from, path.join(dir, entry.name));
    }
  }

  private async same(from: string, to: string): Promise<boolean> {
    if ((await this.fs.readLink(to)) !== undefined) return false;
    if (!(await this.fs.exists(from))) return !(await this.fs.exists(to));
    if (!(await this.fs.exists(to))) {
      return false;
    }
    if (await this.fs.isDirectory(from)) {
      if (!(await this.fs.isDirectory(to))) return false;
      const a = (await this.fs.readDir(from)).sort();
      const b = (await this.fs.readDir(to)).sort();
      let equal = JSON.stringify(a) === JSON.stringify(b);
      for (const name of a)
        if (!(await this.same(path.join(from, name), path.join(to, name)))) equal = false;
      return equal;
    }
    if (await this.fs.isDirectory(to)) return false;
    const a = await this.fs.readBytes(from);
    const b = await this.fs.readBytes(to);
    return (
      a !== undefined &&
      b !== undefined &&
      a.length === b.length &&
      a.every((value, index) => value === b[index])
    );
  }

  private async validateTree(from: string): Promise<void> {
    if ((await this.fs.readLink(from)) !== undefined)
      throw new DevkitError(
        'config',
        'MANIFEST_SOURCE_INVALID',
        `Source payload paths must not be symbolic links: ${from}`,
        {
          nextSteps: [
            `Replace ${from} with a regular file or directory in the source, then retry.`,
          ],
        },
      );
    if (await this.fs.isDirectory(from))
      for (const name of await this.fs.readDir(from))
        await this.validateTree(path.join(from, name));
  }

  private async sourceRoot(): Promise<{ root: string; flat: boolean }> {
    const base = path.resolve(this.dir);
    if (await this.fs.exists(path.join(base, MANIFEST_DIR, 'workspace.yaml')))
      return { root: base, flat: false };
    if (await this.fs.exists(path.join(base, 'workspace.yaml'))) {
      if (path.basename(base) === MANIFEST_DIR) return { root: path.dirname(base), flat: false };
      return { root: base, flat: true };
    }
    throw new DevkitError(
      'not_found',
      'MANIFEST_SOURCE_INVALID',
      `${base} holds no workspace.yaml, directly or under manifest/`,
      {
        nextSteps: ['fx init <dir> --from <git url | directory | ->'],
      },
    );
  }
}
