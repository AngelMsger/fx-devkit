// Compatibility loaders may discover another host's hook entry. Runtime
// evidence from the capability table prevents those entries from dispatching.

import type { AgentHost } from '../../ports/agent-host.js';

export function resolveHookHost(
  hosts: readonly AgentHost[],
  requested: string,
  env: Readonly<Record<string, string | undefined>>,
): AgentHost | null {
  const identified = hosts.filter((host) =>
    host.hooks?.identityEnvironment.some((key) => Boolean(env[key])),
  );
  if (identified.some((host) => host.id !== requested)) return null;
  return hosts.find((host) => host.id === requested && host.hooks !== null) ?? null;
}
