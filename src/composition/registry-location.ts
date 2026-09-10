// Runtime defaults follow the installed package identity; private endpoints stay explicit.
import { runtimeRegistry } from '../adapters/registry/registry-policy.js';
import { DISTRIBUTIONS } from '../domain/distribution.js';

export function configuredRegistry(
  env: NodeJS.ProcessEnv,
  packageName = DISTRIBUTIONS.internal.packageName,
): string | null {
  return runtimeRegistry(packageName, env.FX_REGISTRY);
}
