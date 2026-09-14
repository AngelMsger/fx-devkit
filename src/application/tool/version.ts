// Probe tool versions with a deadline; callers decide whether exceptions propagate.

import type { ResolvedTool } from '../../domain/toolchain/resolve.js';
import { extractSemver } from '../../domain/toolchain/version.js';
import type { Process } from '../../ports/process.js';

export async function probeToolVersion(
  process: Pick<Process, 'run'>,
  tool: Pick<ResolvedTool, 'name' | 'binary' | 'versionArgs'>,
  options: { readonly propagateErrors?: boolean } = {},
): Promise<string | undefined> {
  try {
    const result = await process.run([tool.binary, ...tool.versionArgs], {
      timeoutMs: 5000,
      diagnostic: { phase: `${tool.name} version probe` },
    });
    return result.code === 0 ? extractSemver(`${result.stdout}\n${result.stderr}`) : undefined;
  } catch (error) {
    if (options.propagateErrors) throw error;
    return undefined;
  }
}
