// The responsibilities a workspace needs, independent of who provides them. Workspace-
// scoped ones are bound once in workspace.yaml; environment-scoped ones are bound per
// platform instance in environments.yaml; internal ones are wired by the tool itself.

export const CAPABILITIES = [
  'code-host',
  'issue-tracker',
  'knowledge-base',
  'im',
  'calendar',
  'meeting',
  'task',
  'worklog',
  'error-tracker',
  'log-store',
  'metrics',
  'ci',
  'cluster',
  'installer',
  'agent-host',
  'git',
  'manifest-source',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type CapabilityScope = 'workspace' | 'environment' | 'internal';

export interface CapabilityInfo {
  readonly scope: CapabilityScope;
  readonly desc: string;
}

export const CAPABILITY_INFO: Record<Capability, CapabilityInfo> = {
  'code-host': { scope: 'workspace', desc: 'where repositories, forks and pull requests live' },
  'issue-tracker': { scope: 'workspace', desc: 'where work items are tracked' },
  'knowledge-base': { scope: 'workspace', desc: 'where team documentation lives' },
  im: { scope: 'workspace', desc: 'how people are messaged' },
  calendar: { scope: 'workspace', desc: 'where schedules and availability live' },
  meeting: { scope: 'workspace', desc: 'where online meetings, recordings and minutes live' },
  task: { scope: 'workspace', desc: 'where personal and team to-dos are tracked' },
  worklog: { scope: 'workspace', desc: 'where time spent on work is recorded' },
  'error-tracker': { scope: 'environment', desc: 'where runtime errors are collected' },
  'log-store': { scope: 'environment', desc: 'where logs are searched' },
  metrics: { scope: 'environment', desc: 'where service metrics are queried' },
  ci: { scope: 'environment', desc: 'where builds run' },
  cluster: { scope: 'environment', desc: 'where services run; read-only from fx' },
  installer: { scope: 'internal', desc: 'how a companion tool is installed' },
  'agent-host': { scope: 'internal', desc: 'a coding agent that loads Skills' },
  git: { scope: 'internal', desc: 'the local git executable' },
  'manifest-source': { scope: 'internal', desc: 'where the manifest is fetched from' },
};

export function capabilitiesInScope(scope: CapabilityScope): Capability[] {
  return CAPABILITIES.filter((c) => CAPABILITY_INFO[c].scope === scope);
}

// The capabilities a manifest binds, and so the only ones worth asking about: an
// internal one has no binding to report.
export function bindableCapabilities(): Capability[] {
  return CAPABILITIES.filter((c) => CAPABILITY_INFO[c].scope !== 'internal');
}

// A manifest may name a responsibility this fx does not implement. The name is kept as
// written so reports quote the document; `knownCapability` is the one place that tells
// the two apart, and callers that only print or compare need neither.
export type CapabilityName = Capability | (string & {});

export function knownCapability(name: CapabilityName): Capability | null {
  return (CAPABILITIES as readonly string[]).includes(name) ? (name as Capability) : null;
}
