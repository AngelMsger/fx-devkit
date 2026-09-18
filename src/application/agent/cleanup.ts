// What unpicking an agent asks each resource owner to clean up. Unpicking is
// global, so the same request reaches every registered workspace.

import type { WritePosture } from '../safety/posture.js';

export interface AgentCleanupInput {
  readonly ids: readonly string[];
  readonly dryRun: boolean;
  readonly posture: WritePosture;
  readonly env: NodeJS.ProcessEnv;
}
