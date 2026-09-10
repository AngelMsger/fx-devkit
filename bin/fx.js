#!/usr/bin/env node
// The only file that knows where the compiled entry lives.
const argv = process.argv.slice(2);
if (
  (argv[0] === 'hook' && argv[1] === 'dispatch' && !argv.includes('--help')) ||
  argv[0] === '__hook-background'
) {
  import('../dist/cli/hook-entry.js')
    .then((m) =>
      m.hookMain(argv.slice(argv[0] === 'hook' ? 2 : 1), argv[0] === '__hook-background'),
    )
    .catch(() => {
      process.exitCode = 0;
    });
} else {
  import('../dist/cli/main.js').then((m) => m.main(argv));
}
