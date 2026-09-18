// @ts-check
// Environment assignment is performed here rather than through shell syntax.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run',
    'test/contract',
  ],
  {
    env: { ...process.env, FX_TEST_LIVE: '1' },
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
