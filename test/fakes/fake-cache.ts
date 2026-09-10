import type { Cache } from '../../src/ports/stores.js';

export class FakeCache implements Cache {
  readonly entries = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.entries.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, value);
  }
}
