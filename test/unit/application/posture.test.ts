import { describe, expect, it } from 'vitest';

import { assertWritable, resolvePosture } from '../../../src/application/safety/posture.js';

describe('resolvePosture', () => {
  it('lets --allow-writes override an environment or file lock', () => {
    const posture = resolvePosture({
      allowWrites: true,
      env: { FX_READ_ONLY: '1' },
      file: { read_only: true },
    });
    expect(posture).toEqual({ readOnly: false, source: 'flag' });
  });

  it('lets the environment override the file', () => {
    expect(
      resolvePosture({
        allowWrites: false,
        env: { FX_READ_ONLY: 'false' },
        file: { read_only: true },
      }),
    ).toEqual({ readOnly: false, source: 'env' });
    expect(resolvePosture({ allowWrites: false, env: { FX_READ_ONLY: 'yes' }, file: {} })).toEqual({
      readOnly: true,
      source: 'env',
    });
  });

  it('falls back to the file and then to writable', () => {
    expect(resolvePosture({ allowWrites: false, env: {}, file: { read_only: true } })).toEqual({
      readOnly: true,
      source: 'file',
    });
    expect(resolvePosture({ allowWrites: false, env: {}, file: {} })).toEqual({
      readOnly: false,
      source: 'default',
    });
  });
});

describe('assertWritable', () => {
  it('blocks a write under read-only posture with the override spelled out', () => {
    expect(() => assertWritable({ readOnly: true, source: 'env' }, 'config set format')).toThrow(
      expect.objectContaining({ category: 'permission', code: 'READONLY_BLOCKED' }),
    );
    try {
      assertWritable({ readOnly: true, source: 'env' }, 'config set format');
    } catch (err) {
      const e = err as { hint: string; nextSteps: string[] };
      expect(e.hint).toContain('--allow-writes');
      expect(e.nextSteps.join(' ')).toContain('--dry-run');
    }
  });

  it('is silent when writes are allowed', () => {
    expect(() => assertWritable({ readOnly: false, source: 'default' }, 'x')).not.toThrow();
  });
});
