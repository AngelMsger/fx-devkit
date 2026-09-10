// The generic package carries no registry address. Runtime and CI supply the
// same non-secret coordinate through FX_REGISTRY; missing/unsafe input stays null.

import { privateRegistry } from '../adapters/registry/registry-policy.js';

export function configuredRegistry(env: NodeJS.ProcessEnv): string | null {
  return privateRegistry(env.FX_REGISTRY);
}
