#!/usr/bin/env node
// No CLI initialization may write to this protocol's stdout.
import('../dist/adapters/process/stdio-bridge.js')
  .then((entry) => entry.runStdioBridge(process.argv.slice(2)))
  .catch(() => {
    process.exitCode = 1;
  });
