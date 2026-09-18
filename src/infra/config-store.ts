// Validate and atomically update personal configuration under a cross-process lease.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import { configFileSchema } from '../domain/config/file.js';
import { busyError, DevkitError } from '../domain/errors.js';
import { assertWorkspaceNames } from '../domain/workspace/name.js';
import type { ConfigFile, ConfigStore } from '../ports/stores.js';

import { FileLock } from './lock.js';

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
    await this.update(() => next);
  }

  async update(
    change: (current: ConfigFile) => ConfigFile | Promise<ConfigFile>,
  ): Promise<ConfigFile> {
    const lease = await new FileLock(this.home).acquire({ key: 'config', waitMs: 5000 });
    if (lease === null)
      throw busyError('CONFIG_BUSY', 'The personal configuration', {
        nextSteps: ['Retry the configuration change.'],
      });
    const temporary = `${this.path()}.${randomUUID()}.tmp`;
    try {
      const next = await change(await this.read());
      assertWorkspaceNames(Object.keys(next.workspaces ?? {}));
      if (!configFileSchema.safeParse(next).success)
        throw new DevkitError('config', 'CONFIG_INVALID', 'Invalid configuration update');
      await fs.writeFile(temporary, stringify(next), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.path());
      return next;
    } finally {
      try {
        await fs.rm(temporary, { force: true });
      } finally {
        await lease.release();
      }
    }
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
