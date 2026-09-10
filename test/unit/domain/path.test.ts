import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isAtOrInside } from '../../../src/domain/path.js';

describe('isAtOrInside', () => {
  it('tells a child, the directory itself, a sibling and a parent step apart', () => {
    expect(isAtOrInside('/ws/fx', '/ws/fx')).toBe(true);
    expect(isAtOrInside('/ws/fx/src', '/ws/fx')).toBe(true);
    expect(isAtOrInside('/ws/fx/..draft/out.yaml', '/ws/fx')).toBe(true);
    expect(isAtOrInside('/ws/fxtra', '/ws/fx')).toBe(false);
    expect(isAtOrInside('/ws', '/ws/fx')).toBe(false);
    expect(isAtOrInside('/ws/fx/../other', '/ws/fx')).toBe(false);
    expect(isAtOrInside(path.resolve('/elsewhere'), '/ws/fx')).toBe(false);
  });
});
