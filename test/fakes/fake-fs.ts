// An in-memory FileSystem that follows links the way the operating system
// does and leaves the tree as it was when it refuses an operation.
// fs-contract.test.ts holds this class and NodeFs to the same assertions.

import path from 'node:path';

import { asDevkitError, DevkitError } from '../../src/domain/errors.js';
import type { FileSystem } from '../../src/ports/fs.js';

export class FakeFs implements FileSystem {
  readonly writes: string[] = [];
  private readonly dirs = new Set<string>();
  readonly links = new Map<string, string>();

  constructor(private readonly files: Map<string, string> = new Map()) {}

  mkdir(dir: string): void {
    this.dirs.add(path.resolve(dir));
  }

  static from<T extends FakeFs>(
    this: new (files: Map<string, string>) => T,
    entries: Record<string, string>,
  ): T {
    return new this(new Map(Object.entries(entries).map(([k, v]) => [path.resolve(k), v])));
  }

  async ensureDir(directory: string): Promise<void> {
    this.dirs.add(this.followed(directory));
  }

  async readBytes(file: string): Promise<Uint8Array | undefined> {
    const text = await this.readText(file);
    return text === undefined ? undefined : new TextEncoder().encode(text);
  }

  async writeBytes(file: string, bytes: Uint8Array): Promise<void> {
    await this.writeText(file, new TextDecoder().decode(bytes));
  }

  async readText(file: string): Promise<string | undefined> {
    const target = this.followed(file);
    if (this.holdsDirectory(target)) throw systemError('EISDIR', file);
    return this.files.get(target);
  }

  async writeText(file: string, text: string): Promise<void> {
    const entry = this.entry(file);
    if (this.links.has(entry) || this.holdsDirectory(entry))
      throw new DevkitError(
        'conflict',
        'PROJECTION_FOREIGN',
        'The projection is not a regular file',
      );
    this.files.set(entry, text);
    this.writes.push(path.resolve(file));
  }

  async exists(file: string): Promise<boolean> {
    const target = this.followed(file);
    return this.files.has(target) || this.holdsDirectory(target);
  }

  async readDir(dir: string): Promise<string[]> {
    const target = this.followed(dir);
    if (this.files.has(target)) throw systemError('ENOTDIR', dir);
    const prefix = below(target);
    const names = new Set<string>();
    for (const p of this.entries()) {
      if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split(path.sep)[0] ?? '');
    }
    names.delete('');
    return [...names];
  }

  async isDirectory(dir: string): Promise<boolean> {
    return this.holdsDirectory(this.followed(dir));
  }

  async readLink(file: string): Promise<string | undefined> {
    return this.links.get(this.entry(file));
  }

  async link(target: string, at: string): Promise<void> {
    const entry = this.entry(at);
    if (this.holds(entry)) throw systemError('EEXIST', at);
    this.links.set(entry, path.resolve(target));
    this.writes.push(path.resolve(at));
  }

  async copyDir(from: string, to: string): Promise<void> {
    const source = this.entry(from);
    if (!this.holds(source)) throw systemError('ENOENT', from);
    const file = this.files.get(source);
    if (file !== undefined) {
      await this.writeText(to, file);
      return;
    }
    const link = this.links.get(source);
    if (link !== undefined) {
      await this.link(link, to);
      return;
    }
    const destination = this.entry(to);
    for (const [p, text] of [...this.files]) {
      if (p.startsWith(below(source)))
        this.files.set(path.join(destination, p.slice(source.length)), text);
    }
    this.dirs.add(destination);
    this.writes.push(path.resolve(to));
  }

  async replaceDir(from: string, to: string): Promise<void> {
    const target = this.entry(to);
    if (this.links.has(target) || this.files.has(target))
      throw new DevkitError('conflict', 'PROJECTION_FOREIGN', 'The projection is not a directory');
    if (!this.holds(this.entry(from))) throw asDevkitError(systemError('ENOENT', from));
    await this.remove(to);
    await this.copyDir(from, to);
  }

  async moveToBackup(target: string): Promise<string> {
    const source = this.entry(target);
    if (!this.holds(source))
      throw new DevkitError('conflict', 'PROJECTION_CHANGED', 'The replacement path changed');
    let backup = `${source}.fx-backup`;
    let suffix = 1;
    while (this.holds(backup)) backup = `${source}.fx-backup-${suffix++}`;
    const destination = (entry: string): string => backup + entry.slice(source.length);
    const selected = (entry: string): boolean =>
      entry === source || entry.startsWith(below(source));
    for (const entries of [this.files, this.links]) {
      for (const [entry, value] of [...entries]) {
        if (!selected(entry)) continue;
        entries.set(destination(entry), value);
        entries.delete(entry);
      }
    }
    for (const entry of [...this.dirs]) {
      if (!selected(entry)) continue;
      this.dirs.add(destination(entry));
      this.dirs.delete(entry);
    }
    this.writes.push(backup, `rm ${source}`);
    return backup;
  }

  async remove(file: string): Promise<void> {
    const target = this.entry(file);
    const selected = (entry: string): boolean =>
      entry === target || entry.startsWith(below(target));
    for (const entries of [this.files, this.links, this.dirs]) {
      for (const entry of [...entries.keys()]) if (selected(entry)) entries.delete(entry);
    }
    this.writes.push(`rm ${path.resolve(file)}`);
  }

  // A link that leads nowhere stays in the answer, as does everything after it.
  async realpath(target: string): Promise<string> {
    const absolute = path.resolve(target);
    const followed = this.followed(absolute);
    if (this.holds(followed)) return followed;
    const parent = path.dirname(absolute);
    return parent === absolute
      ? absolute
      : path.join(await this.realpath(parent), path.basename(absolute));
  }

  // Where a path leads once every link on the way, the last one included, is followed.
  private followed(file: string): string {
    const absolute = path.resolve(file);
    const { root } = path.parse(absolute);
    let current = root;
    for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const target = this.links.get(current);
      if (target !== undefined)
        current = this.followed(path.resolve(path.dirname(current), target));
    }
    return current;
  }

  // The path's own entry: links in its parents are followed, a link at the path is not.
  private entry(file: string): string {
    const absolute = path.resolve(file);
    const parent = path.dirname(absolute);
    return parent === absolute
      ? absolute
      : path.join(this.followed(parent), path.basename(absolute));
  }

  private entries(): string[] {
    return [...this.files.keys(), ...this.dirs, ...this.links.keys()];
  }

  // A directory exists when it was made explicitly or holds something.
  private holdsDirectory(entry: string): boolean {
    return this.dirs.has(entry) || this.entries().some((p) => p.startsWith(below(entry)));
  }

  private holds(entry: string): boolean {
    return this.files.has(entry) || this.links.has(entry) || this.holdsDirectory(entry);
  }
}

function below(directory: string): string {
  return directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
}

type SystemErrorCode = 'ENOENT' | 'EEXIST' | 'EISDIR' | 'ENOTDIR';

function systemError(code: SystemErrorCode, file: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${file}`), { code });
}
