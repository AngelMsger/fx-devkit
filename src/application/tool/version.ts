// A version command is a bounded read, including after an installation. Only a
// successful process with recognizable version output establishes a version.
// Callers own command trust and how an unavailable version affects their workflow.

import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import { extractSemver } from '../../domain/toolchain/version.js';
import type { Process } from '../../ports/process.js';

export async function probeToolVersion(
  process: Pick<Process, 'run'>,
  tool: Pick<ResolvedTool, 'name' | 'binary' | 'versionArgs'>,
): Promise<string | undefined> {
  try {
    const result = await process.run([tool.binary, ...tool.versionArgs], {
      timeoutMs: 5000,
      diagnostic: { phase: `${tool.name} version probe` },
    });
    return result.code === 0 ? extractSemver(`${result.stdout}\n${result.stderr}`) : undefined;
  } catch {
    return undefined;
  }
}
