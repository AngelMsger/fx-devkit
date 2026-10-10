// Persist personal workspace layers using the manifest codec and a workspace lease.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { stringify } from 'yaml';

import { busyError } from '../domain/errors.js';
import { loadLocal } from '../domain/manifest/loader.js';
import type { LocalLayer } from '../domain/manifest/types.js';
import type { LocalLayerStore } from '../ports/stores.js';

import { writeAtomicFile } from './atomic-file.js';
import { FileLock } from './lock.js';
import { localLayerPath } from './workspace-home.js';

export class FileLocalLayerStore implements LocalLayerStore {
  constructor(private readonly home: string) {}

  path(workspace: string): string {
    return localLayerPath(this.home, workspace);
  }

  async read(workspace: string): Promise<LocalLayer> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path(workspace), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
    return loadLocal(raw).doc;
  }

  async write(workspace: string, next: LocalLayer): Promise<void> {
    await this.persist(workspace, async () => next);
  }

  async update(
    workspace: string,
    change: (current: LocalLayer) => LocalLayer | Promise<LocalLayer>,
  ): Promise<LocalLayer> {
    return this.persist(workspace, async () => change(await this.read(workspace)));
  }

  private async persist(workspace: string, change: () => Promise<LocalLayer>): Promise<LocalLayer> {
    const file = this.path(workspace);
    const lease = await new FileLock(this.home).acquire({
      key: `local:${workspace}`,
      waitMs: 5000,
    });
    if (lease === null)
      throw busyError('WORKSPACE_BUSY', `The personal layer for ${workspace}`, {
        nextSteps: ['Retry the selection change.'],
      });
    try {
      const next = await change();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await writeAtomicFile(file, stringify(next));
      return next;
    } finally {
      await lease.release();
    }
  }
}
