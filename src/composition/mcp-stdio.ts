// The MCP bridge runs as its own process entry; composition is where that
// entry reaches the adapter owning child processes.

export { runStdioBridge } from '../adapters/process/stdio-bridge.js';
