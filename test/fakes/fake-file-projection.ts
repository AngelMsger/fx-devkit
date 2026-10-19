// The ProjectionStore over a FileSystem, deciding in the order
// FileProjectionStore does; projection-contract.test.ts holds both to the
// same assertions. `writes` counts the writes that changed a file.

import path from 'node:path';

import { projectionLeaseKey } from '../../src/domain/lease.js';
import type { FileSystem } from '../../src/ports/fs.js';
import type { Lock } from '../../src/ports/lock.js';
import type {
  ProjectionPath,
  ProjectionSnapshot,
  ProjectionStore,
  ProjectionWrite,
  ProjectionWriteResult,
} from '../../src/ports/projection.js';

import { FakeLock } from './fake-lock.js';

export class FakeFileProjection implements ProjectionStore {
  writes = 0;

  constructor(
    private readonly fs: FileSystem,
    private readonly lock: Lock = new FakeLock(),
  ) {}

  async read(at: ProjectionPath): Promise<ProjectionSnapshot> {
    const file = path.resolve(at.root, at.relative);
    if ((await this.fs.isDirectory(file)) || (await this.crossesLink(at.root, file)))
      return { kind: 'foreign', text: null };
    const text = await this.fs.readText(file);
    return text === undefined ? { kind: 'absent', text: null } : { kind: 'file', text };
  }

  async write(input: ProjectionWrite): Promise<ProjectionWriteResult> {
    if (input.before.kind === 'foreign') return 'conflict';
    if (input.before.text === input.text) return 'unchanged';
    const file = path.resolve(input.root, input.relative);
    const lease = await this.lock.acquire({ key: projectionLeaseKey(file), waitMs: 0 });
    if (!lease) return 'busy';
    try {
      const current = await this.read(input);
      if (current.kind !== input.before.kind || current.text !== input.before.text)
        return 'conflict';
      if (input.text === null) await this.fs.remove(file);
      else await this.fs.writeText(file, input.text);
      this.writes++;
      return 'written';
    } finally {
      await lease.release();
    }
  }

  // A link at the root, at the path or anywhere between them.
  private async crossesLink(root: string, file: string): Promise<boolean> {
    let at = path.resolve(root);
    for (const part of ['', ...path.relative(at, file).split(path.sep)]) {
      at = path.join(at, part);
      if ((await this.fs.readLink(at)) !== undefined) return true;
    }
    return false;
  }
}
