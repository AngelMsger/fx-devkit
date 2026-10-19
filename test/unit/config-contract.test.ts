// Every exposed setting must remain available in personal storage and exported
// profiles; otherwise a saved or transferred preference silently disappears.

import { describe, expect, it } from 'vitest';

import { KEYS } from '../../src/application/config/keys.js';
import { profileSchema } from '../../src/domain/config/profile.js';
import { CONFIG_FILE_KEYS } from '../../src/infra/config-store.js';

const expected = [...KEYS.map((k) => k.name), 'workspaces'].sort();

describe('config contract', () => {
  it('keeps the key registry, the store schema and the profile schema in agreement', () => {
    expect(CONFIG_FILE_KEYS).toEqual(expected);
    expect(Object.keys(profileSchema.shape.config.shape).sort()).toEqual(expected);
  });
});
