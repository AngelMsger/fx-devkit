import { describe, expect, it } from 'vitest';

import { runStdioBridge } from '../../../src/adapters/process/stdio-bridge.js';

describe('stdio bridge', () => {
  it('returns the status instead of writing it onto the process', async () => {
    const before = process.exitCode;
    expect(await runStdioBridge([])).toEqual({ exitCode: 2 });
    expect(await runStdioBridge(['fx-fixture-missing-binary'])).toEqual({ exitCode: 127 });
    expect(process.exitCode).toBe(before);
  });
});
