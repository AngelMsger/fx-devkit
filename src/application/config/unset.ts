// Removing one setting. A key that was not set is not an error: the plan simply
// reports that nothing was written.

import type { ConfigStore } from '../../ports/stores.js';
import { assertWritable, type WritePosture } from '../safety/posture.js';

import { findKey } from './resolve.js';
import { spellValue, storedValue } from './values.js';

export interface UnsetConfigInput {
  readonly key: string;
  readonly dryRun: boolean;
  readonly posture: WritePosture;
}

export interface UnsetConfigOutput {
  readonly path: string;
  readonly key: string;
  readonly before: string | null;
  readonly written: boolean;
}

export class UnsetConfig {
  constructor(private readonly store: ConfigStore) {}

  async execute(input: UnsetConfigInput): Promise<UnsetConfigOutput> {
    const key = findKey(input.key);
    const file = await this.store.read();
    const before = spellValue(storedValue(file, key)) ?? null;
    const plan: UnsetConfigOutput = {
      path: this.store.path(),
      key: key.name,
      before,
      written: false,
    };
    if (input.dryRun || before === null) return plan;
    assertWritable(input.posture, `config unset ${key.name}`);
    const { [key.name]: _removed, ...rest } = file;
    await this.store.write(rest);
    return { ...plan, written: true };
  }
}
