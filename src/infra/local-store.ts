// ~/.fx/workspaces/<name>/local.yaml on disk. Reading goes through the same
// loader as everything else, so a hand-edited layer that copies a shared
// field is refused here too.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { stringify } from 'yaml';

import { loadLocal } from '../domain/manifest/loader.js';
import type { LocalLayer } from '../domain/manifest/types.js';
import type { LocalLayerStore } from '../ports/stores.js';

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
    const file = this.path(workspace);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, stringify(next), 'utf8');
  }
}
