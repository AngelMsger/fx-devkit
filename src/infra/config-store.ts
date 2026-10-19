// Validate and atomically update personal configuration under a cross-process lease.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import { configFileSchema } from '../domain/config/file.js';
import { busyError, DevkitError } from '../domain/errors.js';
import { withLease } from '../domain/lease.js';
import { assertWorkspaceNames } from '../domain/workspace/name.js';
import type { Lock } from '../ports/lock.js';
import type { ConfigFile, ConfigStore } from '../ports/stores.js';

import { writeAtomicFile } from './atomic-file.js';

export class FileConfigStore implements ConfigStore {
  constructor(
    private readonly home: string,
    private readonly lock: Lock,
  ) {}

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
    return withLease(
      this.lock,
      { key: 'config', waitMs: 5000 },
      () =>
        busyError('CONFIG_BUSY', 'The personal configuration', {
          nextSteps: ['Retry the configuration change.'],
        }),
      async () => {
        const next = await change(await this.read());
        assertWorkspaceNames(Object.keys(next.workspaces ?? {}));
        if (!configFileSchema.safeParse(next).success)
          throw new DevkitError('config', 'CONFIG_INVALID', 'Invalid configuration update');
        await writeAtomicFile(this.path(), stringify(next));
        return next;
      },
    );
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
