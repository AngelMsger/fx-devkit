// ~/.fx/trust.yaml: which manifest command vectors this person has
// confirmed, per workspace. Fingerprints only; the vectors themselves live
// in the manifest. One command serializes its approvals; atomic replacement
// keeps readers from seeing a partly written document.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import { DevkitError } from '../domain/errors.js';
import type { Clock } from '../ports/clock.js';
import type { Lock } from '../ports/lock.js';
import type { TrustedEntry, TrustStore } from '../ports/stores.js';

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
    const lease = await this.lock.acquire({ key: this.path(), waitMs: 2000 });
    if (lease === null)
      throw new DevkitError('conflict', 'LOCK_BUSY', 'The trust record is being updated', {
        retryable: true,
        hint: 'Another fx process holds the trust lease.',
        nextSteps: ['Retry the command shortly.'],
      });
    try {
      await this.writeRecord(workspace, fingerprint, label);
    } finally {
      await lease.release();
    }
  }

  private async writeRecord(workspace: string, fingerprint: string, label: string): Promise<void> {
    const file = await this.read();
    const entries = {
      ...file.workspaces?.[workspace],
      [fingerprint]: { label, trusted_at: this.clock.now().toISOString() },
    };
    await fs.mkdir(this.home, { recursive: true });
    const temporary = `${this.path()}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(
        temporary,
        stringify({ workspaces: { ...file.workspaces, [workspace]: entries } }),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      await fs.rename(temporary, this.path());
    } finally {
      await fs.rm(temporary, { force: true });
    }
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
