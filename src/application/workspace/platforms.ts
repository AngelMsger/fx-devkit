// A platform instance narrowed to the query a use case is about to make.
// The registry hands back a Platform and asserts nothing more, and anything
// registered under a capability is accepted, so the method is checked for
// before it is called: a platform that cannot answer is a reason, not a
// crash. When the question is about one environment, the platform that
// environment declares answers it — two environments may be served by
// different instances of the same capability.

import type { Capability } from '../../domain/capability.js';
import type { PlatformBinding } from '../../domain/manifest/providers.js';
import type { Platform } from '../../ports/platform.js';
import { environmentsOf } from '../env/names.js';

import type { WorkspaceDeps } from './deps.js';

export type Narrowed<P extends Platform> =
  | { readonly binding: PlatformBinding; readonly platform: P; readonly reason?: undefined }
  | { readonly binding?: PlatformBinding; readonly platform?: undefined; readonly reason: string };

// Only the two members it uses, so a caller narrowed to a least-authority
// view of the workspace can still ask.
type PlatformDeps = Pick<WorkspaceDeps, 'ctx' | 'platform'>;

export function platformAs<P extends Platform>(
  deps: PlatformDeps,
  capability: Capability,
  method: keyof P & string,
  env?: string,
): Narrowed<P> {
  const bound = bindingsFor(deps, capability, env);
  const binding = bound[0];
  if (binding === undefined)
    return { reason: `no ${capability} platform${env === undefined ? '' : ` in ${env}`}` };
  if (env !== undefined && bound.length > 1)
    return {
      binding,
      reason: `${bound.map((b) => b.platform).join(' and ')} both serve ${capability} in ${env}`,
    };
  const live = deps.platform(binding);
  if (live === undefined) return { binding, reason: `nothing serves ${binding.platform}` };
  if (typeof (live as unknown as Record<string, unknown>)[method] !== 'function')
    return { binding, reason: `${live.id} offers no ${method} query` };
  return { binding, platform: live as P };
}

function bindingsFor(
  deps: PlatformDeps,
  capability: Capability,
  env: string | undefined,
): PlatformBinding[] {
  const bound = deps.ctx.platforms.filter((b) => b.capability === capability);
  if (env === undefined) return bound.slice(0, 1);
  const declared = environmentsOf(deps.ctx).envs[env]?.platforms ?? {};
  return bound.filter((b) => declared[b.platform] !== undefined);
}
