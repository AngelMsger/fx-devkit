// Gate trials on the CLI's complete preparation verdict, including stages omitted
// from compact reports. Registration and exit zero alone do not establish readiness.
import { readFileSync } from 'node:fs';

const init = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (
  init.operation !== 'apply' ||
  init.preparation_complete !== true ||
  !init.written ||
  !init.sync
) {
  console.error(
    'Sandbox preparation incomplete: inspect init.json and init.stderr before a trial.',
  );
  process.exitCode = 1;
}
