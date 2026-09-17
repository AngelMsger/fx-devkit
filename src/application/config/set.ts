// Plan and apply a validated personal setting.

import type { ConfigStore } from '../../ports/stores.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';
import { assertDefaultWorkspace } from '../workspace/registry.js';

import { findKey } from './resolve.js';
import { parseValue, spellValue, storedValue } from './values.js';

export interface SetConfigInput {
  readonly key: string;
  readonly value: string;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface SetConfigOutput {
  readonly path: string;
  readonly key: string;
  readonly before: string | null;
  readonly after: string;
  readonly written: boolean;
}

export class SetConfig {
  constructor(private readonly store: ConfigStore) {}

  async execute(input: SetConfigInput): Promise<SetConfigOutput> {
    const key = findKey(input.key);
    const value = parseValue(key, input.value);
    const file = await this.store.read();
    if (key.name === 'default_workspace')
      assertDefaultWorkspace({ ...file, default_workspace: String(value) });
    const plan: SetConfigOutput = {
      path: this.store.path(),
      key: key.name,
      before: spellValue(storedValue(file, key)) ?? null,
      after: spellValue(value) ?? '',
      written: false,
    };
    if (input.dryRun) return plan;
    assertWritable(input.posture, `config set ${key.name}`);
    await this.store.update((current) => {
      const next = { ...current, [key.name]: value };
      if (key.name === 'default_workspace') assertDefaultWorkspace(next);
      return next;
    });
    return { ...plan, written: true };
  }
}
