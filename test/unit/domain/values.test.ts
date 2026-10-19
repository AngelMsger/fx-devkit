import { describe, expect, it } from 'vitest';

import { countBy } from '../../../src/domain/values.js';

describe('countBy', () => {
  it('lists each key where it first appears, so a summary keeps a stable field order', () => {
    const rows = [{ action: 'update' }, { action: 'create' }, { action: 'update' }];
    expect(Object.entries(countBy(rows, (row) => row.action))).toEqual([
      ['update', 2],
      ['create', 1],
    ]);
  });
});
