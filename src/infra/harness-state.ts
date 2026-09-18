// Stores harness ownership metadata atomically and rejects foreign files.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as z from 'zod';

import { busyError, DevkitError } from '../domain/errors.js';
import type { HarnessState } from '../domain/harness/ownership.js';
import { assertWorkspaceName } from '../domain/workspace/name.js';
import type { HarnessStateStore } from '../ports/harness-state.js';
import type { Lock } from '../ports/lock.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]+$/);
const relative = z
  .string()
  .refine(
    (value) =>
      !/[\\\x00-\x1f:]/.test(value) &&
      value.split('/').every((part) => !!part && part !== '.' && part !== '..' && part !== '.git'),
  );
const receipt = z.strictObject({
  key: id,
  kind: z.enum(['mcp', 'rules']),
  relative,
  protocol: id,
  name: id,
  agents: z.array(id),
  digest,
  created: z.boolean(),
});
const intent = z
  .strictObject({
    key: id,
    relative,
    before: digest.nullable(),
    after: digest.nullable(),
    receipt: receipt.nullable(),
  })
  .refine(
    (value) =>
      !value.receipt ||
      (value.receipt.key === value.key && value.receipt.relative === value.relative),
  );
const schema = z
  .strictObject({
    owner: z.literal('fx:harness:v1'),
    root: z.string().min(1),
    receipts: z.array(receipt),
    pending: intent.nullable(),
  })
  .refine(
    (value) => new Set(value.receipts.map((item) => item.key)).size === value.receipts.length,
  );

export class FileHarnessState implements HarnessStateStore {
  constructor(
    private readonly home: string,
    private readonly lock: Lock,
  ) {}

  async read(workspace: string): Promise<HarnessState | null> {
    return this.readFile(this.file(workspace));
  }

  async write(workspace: string, state: HarnessState): Promise<void> {
    const file = this.file(workspace);
    let text: string;
    try {
      text = JSON.stringify(schema.parse({ owner: 'fx:harness:v1', ...state }));
    } catch {
      throw invalid();
    }
    await assertParents(this.home, file);
    const lease = await this.lock.acquire({ key: `harness-state:${workspace}`, waitMs: 2000 });
    if (!lease) throw busyError('LOCK_BUSY', 'The harness metadata');
    try {
      await this.readFile(file);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await assertParents(this.home, file);
      await replace(file, text);
    } finally {
      await lease.release();
    }
  }

  private async readFile(file: string): Promise<HarnessState | null> {
    await assertParents(this.home, file);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.nlink !== 1) throw invalid();
      const { owner: _owner, ...state } = schema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw invalid();
    }
  }
  private file(workspace: string): string {
    assertWorkspaceName(workspace);
    return path.join(this.home, 'workspaces', workspace, 'harness.json');
  }
}

async function assertParents(home: string, file: string): Promise<void> {
  const stop = path.dirname(path.resolve(home));
  for (let dir = path.dirname(path.resolve(file)); dir !== stop; dir = path.dirname(dir)) {
    try {
      if (!(await fs.lstat(dir)).isDirectory()) throw invalid();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw invalid();
    }
  }
}
async function replace(file: string, text: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
    if (process.platform !== 'win32') {
      const dir = await fs.open(path.dirname(file), 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
function invalid(): DevkitError {
  return new DevkitError(
    'config',
    'HARNESS_STATE_INVALID',
    'Harness ownership metadata is invalid or foreign.',
    {
      nextSteps: ['Inspect the workspace harness metadata before retrying.', 'fx doctor'],
      hint: 'Do not delete ownership evidence to force replacement of existing native configuration.',
    },
  );
}
