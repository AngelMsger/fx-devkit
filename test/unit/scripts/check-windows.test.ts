// The native acceptance entry, on a host that is not Windows: it must refuse
// rather than count a skipped runtime as evidence, and leave that refusal on
// record. On Windows this would be the acceptance run itself, so it is skipped.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { tempDir } from '../../temp.js';

describe.skipIf(process.platform === 'win32')('the Windows acceptance entry', () => {
  it('refuses on another platform and still records why nothing was checked', () => {
    const root = tempDir('fx-windows-check-test-');
    const report = path.join(root, 'nested', 'report.json');
    const run = spawnSync(process.execPath, ['scripts/check-windows.mjs'], {
      encoding: 'utf8',
      // The entry makes its own scratch directory before it checks the platform.
      env: { ...process.env, TMPDIR: root, FX_WINDOWS_REPORT: report },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Run this entry on native Windows.');
    expect(run.stderr).toContain(report);
    expect(JSON.parse(readFileSync(report, 'utf8'))).toEqual({
      platform: process.platform,
      node: process.version,
      started_at: expect.any(String),
      checks: [],
      ok: false,
    });
  });
});
