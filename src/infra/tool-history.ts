// A versioned personal ledger preserves every checkpoint under an atomic, locked append.
// Invalid or foreign files fail closed, so installation cannot silently lose its audit trail.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as z from 'zod';

import { busyError, DevkitError } from '../domain/errors.js';
import type { ToolInstallation } from '../domain/toolchain/installation.js';
import type { Lock } from '../ports/lock.js';
import type { ToolHistoryStore } from '../ports/tool-history.js';

import { writeAtomicFile } from './atomic-file.js';
import type { ShapeOf } from './stored-shape.js';

const entry = {
  id: z.string().uuid(),
  at: z.string().datetime(),
  event: z.enum(['started', 'installed', 'finished']),
  operation: z.enum(['init', 'install', 'update']),
  workspace: z.string().nullable(),
  name: z.string(),
  binary: z.string(),
  via: z.enum(['npm', 'brew', 'go']),
  spec: z.string(),
  vector: z.array(z.string()),
  code: z.number().int().nullable(),
  version_after: z.string().nullable(),
  binary_path: z.string().nullable(),
  failure_code: z.string().nullable(),
  installation_origin: z.enum(['fx', 'external', 'unknown']).optional(),
  binary_path_before: z.string().nullable().optional(),
} satisfies ShapeOf<ToolInstallation>;
const ledger = (object: typeof z.strictObject) =>
  object({
    owner: z.enum(['fx:tool-history:v1', 'fx:tool-history:v2']),
    entries: z.array(object(entry)),
  });

const written = ledger(z.strictObject);
const read = ledger(z.object);

export class FileToolHistoryStore implements ToolHistoryStore {
  constructor(
    private readonly home: string,
    private readonly lock: Lock,
  ) {}

  async read(): Promise<readonly ToolInstallation[]> {
    await this.checkHome();
    try {
      const stat = await fs.lstat(this.file());
      if (!stat.isFile() || stat.nlink !== 1) throw invalid();
      return read.parse(JSON.parse(await fs.readFile(this.file(), 'utf8'))).entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw invalid();
    }
  }

  async append(entry: ToolInstallation): Promise<void> {
    await this.checkHome();
    const lease = await this.lock.acquire({ key: 'tool-history', waitMs: 2000 });
    if (!lease)
      throw busyError('TOOL_HISTORY_BUSY', 'The tool history', {
        nextSteps: ['Retry after the other tool operation finishes.'],
      });
    try {
      const entries = [...(await this.read()), entry];
      const parsed = written.safeParse({ owner: 'fx:tool-history:v2', entries });
      if (!parsed.success) throw invalid();
      await fs.mkdir(this.home, { recursive: true, mode: 0o700 });
      await this.checkHome();
      await writeAtomicFile(this.file(), JSON.stringify(parsed.data) + '\n', { durable: true });
    } finally {
      await lease.release();
    }
  }

  private file(): string {
    return path.join(this.home, 'tool-history.json');
  }

  private async checkHome(): Promise<void> {
    try {
      if (!(await fs.lstat(this.home)).isDirectory()) throw invalid();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw invalid();
    }
  }
}

function invalid(): DevkitError {
  return new DevkitError(
    'config',
    'TOOL_HISTORY_INVALID',
    'The tool installation ledger is invalid or unreadable',
    {
      nextSteps: [
        'Inspect and repair FX_HOME/tool-history.json, preserving the existing audit evidence, before retrying.',
      ],
    },
  );
}
