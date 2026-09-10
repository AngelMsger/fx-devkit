// ~/.fx/config.yaml on disk. The schema is strict on purpose: a misspelled
// key would otherwise be silently ignored and the user left wondering why a
// setting has no effect.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import { configFileSchema } from '../domain/config/file.js';
import { DevkitError } from '../domain/errors.js';
import { assertWorkspaceNames } from '../domain/workspace/name.js';
import type { ConfigFile, ConfigStore } from '../ports/stores.js';

// Every key this store accepts; the config contract keeps the key
// registry, this schema and the profile schema in agreement.
export const CONFIG_FILE_KEYS = Object.keys(configFileSchema.shape).sort();

export class FileConfigStore implements ConfigStore {
  constructor(private readonly home: string) {}

  path(): string {
    return path.join(this.home, 'config.yaml');
  }

  async read(): Promise<ConfigFile> {
    const raw = await this.readRaw();
    if (raw === undefined) return {};
    const parsed = configFileSchema.safeParse(this.decode(raw));
    if (parsed.success) {
      assertWorkspaceNames(Object.keys(parsed.data.workspaces ?? {}));
      return parsed.data as ConfigFile;
    }
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new DevkitError('config', 'CONFIG_INVALID', `${this.path()}: ${issues}`, {
      hint: 'Fix or remove the offending key; `fx config list` shows the known keys.',
      nextSteps: ['fx config list', `Edit ${this.path()}`],
    });
  }

  async write(next: ConfigFile): Promise<void> {
    assertWorkspaceNames(Object.keys(next.workspaces ?? {}));
    await fs.mkdir(this.home, { recursive: true });
    await fs.writeFile(this.path(), stringify(next), 'utf8');
  }

  private async readRaw(): Promise<string | undefined> {
    try {
      return await fs.readFile(this.path(), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  private decode(raw: string): unknown {
    try {
      return parse(raw) ?? {};
    } catch {
      throw new DevkitError('config', 'CONFIG_INVALID', `${this.path()}: invalid YAML`, {
        hint: 'Fix the YAML syntax before changing configuration.',
        nextSteps: [`Edit ${this.path()}`, 'fx config list'],
      });
    }
  }
}
