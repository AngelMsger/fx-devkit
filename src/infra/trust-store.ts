// Persist approved command fingerprints under a file lease; command vectors stay
// in the manifest. Queue approvals within one command to avoid self-contention.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import { busyError } from '../domain/errors.js';
import { withLease } from '../domain/lease.js';
import type { Clock } from '../ports/clock.js';
import type { Lock } from '../ports/lock.js';
import type { TrustedEntry, TrustStore } from '../ports/stores.js';

import { writeAtomicFile } from './atomic-file.js';

interface TrustFile {
  workspaces?: Record<string, Record<string, { label: string; trusted_at: string }>>;
}

export class FileTrustStore implements TrustStore {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly home: string,
    private readonly clock: Clock,
    private readonly lock: Lock,
  ) {}

  path(): string {
    return path.join(this.home, 'trust.yaml');
  }

  async isTrusted(workspace: string, fingerprint: string): Promise<boolean> {
    return (await this.read()).workspaces?.[workspace]?.[fingerprint] !== undefined;
  }

  trust(workspace: string, fingerprint: string, label: string): Promise<void> {
    const operation = this.pending.then(() => this.record(workspace, fingerprint, label));
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  private async record(workspace: string, fingerprint: string, label: string): Promise<void> {
    await withLease(
      this.lock,
      { key: this.path(), waitMs: 2000 },
      () => busyError('LOCK_BUSY', 'The trust record'),
      () => this.writeRecord(workspace, fingerprint, label),
    );
  }

  private async writeRecord(workspace: string, fingerprint: string, label: string): Promise<void> {
    const file = await this.read();
    const entries = {
      ...file.workspaces?.[workspace],
      [fingerprint]: { label, trusted_at: this.clock.now().toISOString() },
    };
    await fs.mkdir(this.home, { recursive: true });
    await writeAtomicFile(
      this.path(),
      stringify({ workspaces: { ...file.workspaces, [workspace]: entries } }),
    );
  }

  async list(workspace: string): Promise<TrustedEntry[]> {
    return Object.entries((await this.read()).workspaces?.[workspace] ?? {}).map(
      ([fingerprint, e]) => ({
        fingerprint,
        label: e.label,
        trusted_at: e.trusted_at,
      }),
    );
  }

  private async read(): Promise<TrustFile> {
    try {
      return (parse(await fs.readFile(this.path(), 'utf8')) as TrustFile | null) ?? {};
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }
}
