// An in-memory filesystem view isolates candidate validation from the source's
// live files and index. Constructor capture prevents later caller mutation.

import path from 'node:path';

import type { FileReader } from '../../ports/fs.js';

interface SnapshotInput {
  readonly root: string;
  readonly files: Readonly<Record<string, string>>;
}

export class SnapshotReader implements FileReader {
  private readonly files: ReadonlyMap<string, string>;

  constructor(input: SnapshotInput) {
    this.files = new Map(
      Object.entries(input.files).map(([file, content]) => [
        path.resolve(input.root, file),
        content,
      ]),
    );
  }

  async readText(file: string): Promise<string | undefined> {
    return this.files.get(path.resolve(file));
  }

  async readBytes(file: string): Promise<Uint8Array | undefined> {
    const text = await this.readText(file);
    return text === undefined ? undefined : new TextEncoder().encode(text);
  }

  async exists(file: string): Promise<boolean> {
    return this.files.has(path.resolve(file)) || (await this.isDirectory(file));
  }

  async readDir(dir: string): Promise<string[]> {
    const prefix = `${path.resolve(dir)}${path.sep}`;
    return [
      ...new Set(
        [...this.files.keys()]
          .filter((file) => file.startsWith(prefix))
          .map((file) => file.slice(prefix.length).split(path.sep)[0]!),
      ),
    ].sort();
  }

  async isDirectory(dir: string): Promise<boolean> {
    return (await this.readDir(dir)).length > 0;
  }

  async readLink(_file: string): Promise<undefined> {
    return undefined;
  }

  async realpath(file: string): Promise<string> {
    return path.resolve(file);
  }
}
