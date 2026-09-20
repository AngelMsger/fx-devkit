// Compact reports can omit stage rows; completed clones do not make a trial ready.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, it } from 'vitest';

import { tempDir } from '../../temp.js';

it('withholds a trial until preparation is complete, even when repository sync succeeded', () => {
  const file = path.join(tempDir('fx-trial-gate-'), 'init.json');
  const init = {
    operation: 'apply',
    written: true,
    registered: true,
    sync: { summary: { done: 3, failed: 0, unreadable: 0 } },
    output_mode: 'summary',
    preparation_complete: false,
  };
  const check = () =>
    spawnSync(process.execPath, ['docs/eval/check-preparation.mjs', file], { encoding: 'utf8' });
  writeFileSync(file, JSON.stringify(init));
  const incomplete = check();
  expect(incomplete.status).toBe(1);
  expect(incomplete.stderr).toContain('preparation incomplete');
  writeFileSync(file, JSON.stringify({ ...init, preparation_complete: true }));
  const complete = check();
  expect(complete.status, complete.stderr).toBe(0);
});
