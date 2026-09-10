// The native host only launches a real executable. The bundled bridge owns
// batch-shim handling without serializing environment values into configuration.

import { fileURLToPath } from 'node:url';

export function mcpLaunch(
  vector: readonly string[],
  platform = process.platform,
): readonly string[] {
  if (platform !== 'win32') return vector;
  return [
    process.execPath,
    fileURLToPath(new URL('../../../bin/mcp-stdio.js', import.meta.url)),
    ...vector,
  ];
}
