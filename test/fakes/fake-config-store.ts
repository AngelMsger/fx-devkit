import path from 'node:path';

import type { ConfigFile, ConfigStore } from '../../src/ports/stores.js';

export class FakeConfigStore implements ConfigStore {
  writes = 0;

  constructor(private file: ConfigFile = {}) {}

  path(): string {
    return path.resolve('/fake/.fx/config.yaml');
  }

  async read(): Promise<ConfigFile> {
    return structuredClone(this.file);
  }

  async update(change: (current: ConfigFile) => ConfigFile): Promise<ConfigFile> {
    const next = change(await this.read());
    await this.write(next);
    return next;
  }

  async write(next: ConfigFile): Promise<void> {
    this.file = structuredClone(next);
    this.writes += 1;
  }
}
