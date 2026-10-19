// The protocol the owned journals share. A journal is a single-link regular
// file below directories that are not foreign; a write holds the store's lease,
// re-reads the file to confirm it is still the store's own, and flushes it
// around the rename. Each store keeps its codec, lease and error contract.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { withLease } from '../domain/lease.js';
import type { Lock, LockRequest } from '../ports/lock.js';

import { writeAtomicFile } from './atomic-file.js';
import { assertStoreParents } from './store-parents.js';

interface OwnedJournalSpec<Stored> {
  readonly home: string;
  readonly file: string;
  readonly lock: Lock;
  readonly lease: LockRequest;
  // Throws for a value outside what the store may write.
  readonly encode: (value: Stored) => string;
  // Throws for a parsed document the store does not recognize as its own.
  readonly decode: (document: unknown) => Stored;
  readonly invalid: () => Error;
  readonly busy: () => Error;
}

export class OwnedJournal<Stored> {
  constructor(private readonly spec: OwnedJournalSpec<Stored>) {}

  async read(): Promise<Stored | undefined> {
    const { home, file, decode, invalid } = this.spec;
    await assertStoreParents(home, file, invalid);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.nlink !== 1) throw invalid();
      return decode(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw invalid();
    }
  }

  // The value is refused before anything is locked or created.
  async replace(next: Stored): Promise<void> {
    const text = this.encode(next);
    await this.commit(() => text);
  }

  async update(change: (current: Stored | undefined) => Stored): Promise<void> {
    await this.commit((current) => this.encode(change(current)));
  }

  private async commit(textFor: (current: Stored | undefined) => string): Promise<void> {
    const { home, file, lock, lease, invalid, busy } = this.spec;
    await assertStoreParents(home, file, invalid);
    await withLease(lock, lease, busy, async () => {
      const text = textFor(await this.read());
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await assertStoreParents(home, file, invalid);
      await writeAtomicFile(file, text, { durable: true });
    });
  }

  private encode(value: Stored): string {
    try {
      return this.spec.encode(value);
    } catch {
      throw this.spec.invalid();
    }
  }
}
