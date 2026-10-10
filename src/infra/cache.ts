// ~/.fx/cache: one JSON file per key with an expiry, disposable at any time. No
// failure here is anyone's error and no symlink is followed; see "Personal
// stores" in docs/design/runtime.md.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Clock } from '../ports/clock.js';
import type { Cache } from '../ports/stores.js';

import { writeAtomicFile } from './atomic-file.js';

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
    try {
      await fs.mkdir(this.dir, { recursive: true });
      if (!(await this.isOwnDirectory())) return;
      await writeAtomicFile(file, JSON.stringify(entry), { mode: 0o666 });
    } catch {
      // Cache persistence is best-effort; the next read can probe again.
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
