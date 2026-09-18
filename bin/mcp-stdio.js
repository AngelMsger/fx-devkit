#!/usr/bin/env node
// No CLI initialization may write to this protocol's stdout.
import('../dist/cli/mcp-stdio.js')
  .then((entry) => entry.mcpStdioMain(process.argv.slice(2)))
  .catch(() => {
    process.exitCode = 1;
  });
