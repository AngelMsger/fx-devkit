import path from 'node:path';

import { DevkitError } from '../../src/domain/errors.js';
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

  async readBytes(file: string): Promise<Uint8Array | undefined> {
    const text = await this.readText(file);
    return text === undefined ? undefined : new TextEncoder().encode(text);
  }

  async writeBytes(file: string, bytes: Uint8Array): Promise<void> {
    await this.writeText(file, new TextDecoder().decode(bytes));
  }

  async readText(file: string): Promise<string | undefined> {
    return this.files.get(path.resolve(file));
  }

  async writeText(file: string, text: string): Promise<void> {
    this.files.set(path.resolve(file), text);
    this.writes.push(path.resolve(file));
  }

  // A directory exists when it was made explicitly or holds a file.
  async exists(file: string): Promise<boolean> {
    const target = path.resolve(file);
    if (this.files.has(target) || this.dirs.has(target) || this.links.has(target)) return true;
    const prefix = target.endsWith(path.sep) ? target : `${target}${path.sep}`;
    return [...this.files.keys(), ...this.dirs].some((p) => p.startsWith(prefix));
  }

  async readDir(dir: string): Promise<string[]> {
    const prefix = `${path.resolve(dir)}${path.sep}`;
    const names = new Set<string>();
    for (const p of [...this.files.keys(), ...this.dirs, ...this.links.keys()]) {
      if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split(path.sep)[0] ?? '');
    }
    names.delete('');
    return [...names];
  }

  async isDirectory(dir: string): Promise<boolean> {
    const target = path.resolve(dir);
    if (this.links.has(target)) return false;
    const inside = (p: string): boolean => p.startsWith(`${target}${path.sep}`);
    return this.dirs.has(target) || [...this.files.keys(), ...this.dirs].some(inside);
  }

  async readLink(file: string): Promise<string | undefined> {
    return this.links.get(path.resolve(file));
  }

  async link(target: string, at: string): Promise<void> {
    this.links.set(path.resolve(at), target);
    this.writes.push(path.resolve(at));
  }

  async copyDir(from: string, to: string): Promise<void> {
    const file = this.files.get(path.resolve(from));
    if (file !== undefined) {
      await this.writeText(to, file);
      return;
    }
    const link = this.links.get(path.resolve(from));
    if (link !== undefined) {
      await this.link(link, to);
      return;
    }
    const prefix = `${path.resolve(from)}${path.sep}`;
    for (const [p, text] of [...this.files]) {
      if (p.startsWith(prefix))
        this.files.set(path.join(path.resolve(to), p.slice(prefix.length)), text);
    }
    this.dirs.add(path.resolve(to));
    this.writes.push(path.resolve(to));
  }

  async replaceDir(from: string, to: string): Promise<void> {
    await this.remove(to);
    await this.copyDir(from, to);
  }

  async moveToBackup(target: string): Promise<string> {
    const source = path.resolve(target);
    if (!(await this.exists(source)))
      throw new DevkitError('conflict', 'PROJECTION_CHANGED', 'The replacement path changed');
    let backup = `${source}.fx-backup`;
    let suffix = 1;
    while ((await this.exists(backup)) || (await this.readLink(backup)) !== undefined)
      backup = `${source}.fx-backup-${suffix++}`;
    const destination = (entry: string): string => backup + entry.slice(source.length);
    const selected = (entry: string): boolean =>
      entry === source || entry.startsWith(`${source}${path.sep}`);
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
    const target = path.resolve(file);
    this.links.delete(target);
    this.dirs.delete(target);
    for (const p of [...this.files.keys()]) {
      if (p === target || p.startsWith(`${target}${path.sep}`)) this.files.delete(p);
    }
    for (const d of [...this.dirs]) if (d.startsWith(`${target}${path.sep}`)) this.dirs.delete(d);
    this.writes.push(`rm ${target}`);
  }

  async realpath(target: string): Promise<string> {
    return path.resolve(target);
  }
}
