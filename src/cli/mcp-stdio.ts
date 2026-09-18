// The MCP bridge's process entry. Nothing here may write to the protocol's
// streams; it only lands the bridge's exit status.

import { runStdioBridge } from '../composition/mcp-stdio.js';

export async function mcpStdioMain(argv: readonly string[]): Promise<void> {
  process.exitCode = (await runStdioBridge(argv)).exitCode;
}
