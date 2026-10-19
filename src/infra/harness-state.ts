// Stores harness ownership metadata atomically and rejects foreign files.

import * as z from 'zod';

import { busyError, DevkitError } from '../domain/errors.js';
import type { HarnessIntent, HarnessReceipt, HarnessState } from '../domain/harness/ownership.js';
import { isPlainRelativePath } from '../domain/path.js';
import type { HarnessStateStore } from '../ports/harness-state.js';
import type { Lock } from '../ports/lock.js';

import { OwnedJournal } from './owned-journal.js';
import type { ShapeOf } from './stored-shape.js';
import { harnessStatePath } from './workspace-home.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]+$/);
const relative = z.string().refine(isPlainRelativePath);
const receipt = {
  key: id,
  kind: z.enum(['mcp', 'rules']),
  relative,
  protocol: id,
  name: id,
  agents: z.array(id),
  digest,
  created: z.boolean(),
} satisfies ShapeOf<HarnessReceipt>;
const consistentIntent = (value: HarnessIntent): boolean =>
  !value.receipt || (value.receipt.key === value.key && value.receipt.relative === value.relative);
const uniqueKeys = (value: { receipts: readonly HarnessReceipt[] }): boolean =>
  new Set(value.receipts.map((item) => item.key)).size === value.receipts.length;

const intent = (object: typeof z.strictObject) =>
  object({
    key: id,
    relative,
    before: digest.nullable(),
    after: digest.nullable(),
    receipt: object(receipt).nullable(),
  } satisfies ShapeOf<HarnessIntent>).refine(consistentIntent);
const state = (object: typeof z.strictObject) =>
  object({
    owner: z.literal('fx:harness:v1'),
    root: z.string().min(1),
    receipts: z.array(object(receipt)),
    pending: intent(object).nullable(),
  } satisfies ShapeOf<HarnessState & { owner: 'fx:harness:v1' }>).refine(uniqueKeys);

const written = state(z.strictObject);
const read = state(z.object);

type StoredState = HarnessState & { readonly owner: 'fx:harness:v1' };

export class FileHarnessState implements HarnessStateStore {
  constructor(
    private readonly home: string,
    private readonly lock: Lock,
  ) {}

  async read(workspace: string): Promise<HarnessState | null> {
    const stored = await this.journal(workspace).read();
    if (stored === undefined) return null;
    const { owner: _owner, ...state } = stored;
    return state;
  }

  async write(workspace: string, state: HarnessState): Promise<void> {
    await this.journal(workspace).replace({ owner: 'fx:harness:v1', ...state });
  }

  private journal(workspace: string): OwnedJournal<StoredState> {
    return new OwnedJournal({
      home: this.home,
      file: harnessStatePath(this.home, workspace),
      lock: this.lock,
      lease: { key: `harness-state:${workspace}`, waitMs: 2000 },
      encode: (value) => JSON.stringify(written.parse(value)),
      decode: (document) => read.parse(document),
      invalid,
      busy: () => busyError('LOCK_BUSY', 'The harness metadata'),
    });
  }
}

function invalid(): DevkitError {
  return new DevkitError(
    'config',
    'HARNESS_STATE_INVALID',
    'Harness ownership metadata is invalid or foreign',
    {
      nextSteps: ['Inspect the workspace harness metadata before retrying.', 'fx doctor'],
      hint: 'Do not delete ownership evidence to force replacement of existing native configuration.',
    },
  );
}
