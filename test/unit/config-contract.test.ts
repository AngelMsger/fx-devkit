// One configuration contract: every key the CLI registers must round-trip
// through the on-disk store and travel in a profile. skill_notice once
// drifted out of the store schema; this pins all three surfaces together.

import { describe, expect, it } from 'vitest';

import { KEYS } from '../../src/application/config/keys.js';
import { profileConfig } from '../../src/domain/config/profile.js';
import { CONFIG_FILE_KEYS } from '../../src/infra/config-store.js';

const expected = [...KEYS.map((k) => k.name), 'workspaces'].sort();

describe('config contract', () => {
  it('keeps the key registry, the store schema and the profile schema in agreement', () => {
    expect(CONFIG_FILE_KEYS).toEqual(expected);
    expect(Object.keys(profileConfig.shape).sort()).toEqual(expected);
  });
});
