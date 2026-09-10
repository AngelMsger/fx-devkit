// ~/.fx/cache: one JSON file per key with an expiry. Anything here can be
// deleted at any time; a miss only costs another probe, so nothing that goes
// wrong here (unreadable, unwritable, not a regular file) is anyone's error.
// Nothing is followed either: a symlink where the directory or an entry
// should be is a miss, and a write lands over it, never through it. The
// owner replacing the directory underneath a running fx is not defended
// against: it is their directory, and Node cannot open relative to a
// directory it has verified.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Clock } from '../ports/clock.js';
import type { Cache } from '../ports/stores.js';

interface Entry<T> {
  readonly expires_at: number;
  readonly value: T;
}

export class FileCache implements Cache {
  constructor(
    private readonly home: string,
    private readonly clock: Clock,
  ) {}

  async get<T>(key: string, signal?: AbortSignal): Promise<T | undefined> {
    const file = this.file(key);
    try {
      if (!(await this.isOwnDirectory()) || !(await fs.lstat(file)).isFile()) return undefined;
      const entry = JSON.parse(await fs.readFile(file, { encoding: 'utf8', signal })) as Entry<T>;
      return entry.expires_at > this.clock.now().getTime() ? entry.value : undefined;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const file = this.file(key);
    const entry: Entry<T> = { expires_at: this.clock.now().getTime() + ttlMs, value };
    const draft = `${file}.${process.pid}.tmp`;
    try {
      await fs.mkdir(this.dir, { recursive: true });
      if (!(await this.isOwnDirectory())) return;
      await fs.writeFile(draft, JSON.stringify(entry), { encoding: 'utf8', flag: 'wx' });
      await fs.rename(draft, file);
    } catch {
      await fs.rm(draft, { force: true }).catch(() => undefined);
    }
  }

  private get dir(): string {
    return path.join(this.home, 'cache');
  }

  private file(key: string): string {
    return path.join(this.dir, `${key.replaceAll(/[^A-Za-z0-9._-]+/g, '_')}.json`);
  }

  private async isOwnDirectory(): Promise<boolean> {
    return (await fs.lstat(this.dir)).isDirectory();
  }
}
