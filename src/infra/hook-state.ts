// Hook metadata contains only ownership and bounded, dated status fields.
// Corruption is explicit: losing ownership cannot authorize replacing a file.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as z from 'zod';

import { DevkitError } from '../domain/errors.js';
import type { HookObservation, HookReceipt, HookState } from '../domain/harness/state.js';
import type { HookStateStore } from '../ports/hook-state.js';

import { writeAtomicFile } from './atomic-file.js';
import type { ShapeOf } from './stored-shape.js';

const receipt = {
  agent: z.string(),
  relative: z.string(),
  owner: z.string(),
  created: z.boolean(),
} satisfies ShapeOf<HookReceipt>;
const observation = {
  checkedAt: z.number(),
  phase: z.string(),
  code: z.string(),
  command: z.string().nullable(),
  detail: z.string().optional(),
} satisfies ShapeOf<HookObservation>;
const state = {
  root: z.string(),
  receipts: z.array(z.strictObject(receipt)),
  lastAttempt: z.number().nullable(),
  lastRefresh: z.number().nullable(),
  observations: z.array(z.strictObject(observation)),
} satisfies ShapeOf<HookState>;

const written = z.strictObject(state);
const read = z.object({
  ...state,
  receipts: z.array(z.object(receipt)),
  observations: z.array(z.object(observation)),
});

export class FileHookState implements HookStateStore {
  constructor(private readonly home: string) {}

  async read(workspace: string): Promise<HookState | null> {
    try {
      return read.parse(JSON.parse(await fs.readFile(this.file(workspace), 'utf8')));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new DevkitError(
        'config',
        'HOOK_STATE_INVALID',
        `Hook metadata could not be read: ${this.file(workspace)}`,
        {
          hint: 'Inspect the workspace hook metadata before retrying.',
          nextSteps: ['fx self info', 'Repair the hook metadata file, then run fx hook list.'],
          cause: err,
        },
      );
    }
  }

  async write(workspace: string, state: HookState): Promise<void> {
    const file = this.file(workspace);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeAtomicFile(file, JSON.stringify(written.parse(state)));
  }

  private file(workspace: string): string {
    return path.join(this.home, 'workspaces', encodeURIComponent(workspace), 'hooks.json');
  }
}
