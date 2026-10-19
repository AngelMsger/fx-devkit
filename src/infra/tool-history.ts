// A versioned personal ledger preserves every checkpoint under an atomic, locked append.
// Invalid or foreign files fail closed, so installation cannot silently lose its audit trail.

import path from 'node:path';

import * as z from 'zod';

import { busyError, DevkitError } from '../domain/errors.js';
import type { ToolInstallation } from '../domain/toolchain/installation.js';
import type { Lock } from '../ports/lock.js';
import type { ToolHistoryStore } from '../ports/tool-history.js';

import { OwnedJournal } from './owned-journal.js';
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

interface StoredLedger {
  readonly owner: 'fx:tool-history:v1' | 'fx:tool-history:v2';
  readonly entries: readonly ToolInstallation[];
}

export class FileToolHistoryStore implements ToolHistoryStore {
  private readonly ledger: OwnedJournal<StoredLedger>;

  constructor(home: string, lock: Lock) {
    this.ledger = new OwnedJournal({
      home,
      file: path.join(home, 'tool-history.json'),
      lock,
      lease: { key: 'tool-history', waitMs: 2000 },
      encode: (value) => `${JSON.stringify(written.parse(value))}\n`,
      decode: (document) => read.parse(document),
      invalid,
      busy: () =>
        busyError('TOOL_HISTORY_BUSY', 'The tool history', {
          nextSteps: ['Retry after the other tool operation finishes.'],
        }),
    });
  }

  async read(): Promise<readonly ToolInstallation[]> {
    return (await this.ledger.read())?.entries ?? [];
  }

  async append(entry: ToolInstallation): Promise<void> {
    await this.ledger.update((current) => ({
      owner: 'fx:tool-history:v2',
      entries: [...(current?.entries ?? []), entry],
    }));
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
