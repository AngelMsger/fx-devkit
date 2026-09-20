// Projection decisions over the same fake filesystem used by workspace workflows.
import path from 'node:path';

import type { FileSystem } from '../../src/ports/fs.js';
import type {
  ProjectionPath,
  ProjectionSnapshot,
  ProjectionStore,
  ProjectionWrite,
} from '../../src/ports/projection.js';

export class FakeFileProjection implements ProjectionStore {
  constructor(private readonly fs: FileSystem) {}
  async read(at: ProjectionPath): Promise<ProjectionSnapshot> {
    const file = path.resolve(at.root, at.relative);
    if ((await this.fs.isDirectory(file)) || (await this.fs.readLink(file)) !== undefined)
      return { kind: 'foreign', text: null };
    const text = await this.fs.readText(file);
    return text === undefined ? { kind: 'absent', text: null } : { kind: 'file', text };
  }
  async write(input: ProjectionWrite): Promise<'written' | 'unchanged' | 'conflict'> {
    const current = await this.read(input);
    if (
      current.kind === 'foreign' ||
      current.kind !== input.before.kind ||
      current.text !== input.before.text
    )
      return 'conflict';
    if (current.text === input.text) return 'unchanged';
    const file = path.resolve(input.root, input.relative);
    if (input.text === null) await this.fs.remove(file);
    else await this.fs.writeText(file, input.text);
    return 'written';
  }
}
