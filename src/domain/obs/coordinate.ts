// One repository, one environment, one platform → a coordinate. Variables
// merge platform ⊕ environment ⊕ repository override, then {svc}, {repo}
// and {env} are substituted inside the values, and finally the manifest's
// own command template (a shell line, printed verbatim) or the provider's
// default is filled. Absence is an answer: an environment that does not
// declare the platform, a repository marked uncovered, or an entry whose
// confidence is `not_covered`, is `not_covered`.

import type { ResolvedRepo } from '../manifest/local.js';
import type { PlatformBinding } from '../manifest/providers.js';
import type { Environments } from '../manifest/types.js';
import { shellLine, type ResolvedShell } from '../shell.js';
import { placeholders, substitute, type Vars } from '../template.js';

import { weakest, type Confidence } from './confidence.js';
import { coordinateFingerprint } from './observation.js';
import type { Coordinate, ObsCoordinate } from './types.js';

export interface LocateInput {
  readonly commandShell?: ResolvedShell | undefined;
  readonly repo: ResolvedRepo;
  readonly env: string;
  readonly platform: string;
  readonly environments: Environments;
  readonly binding: PlatformBinding | undefined;
  readonly locate?: ((vars: Vars) => Coordinate) | undefined;
}

export function serviceOf(repo: Pick<ResolvedRepo, 'name' | 'obs'>): string {
  return repo.obs?.svc ?? repo.name.replace(/^fx-/, '');
}

export function locateRepo(input: LocateInput): ObsCoordinate {
  const { repo, env, platform, environments, binding } = input;
  const spec = environments.platforms[platform];
  const onEnv = environments.envs[env]?.platforms?.[platform];
  const override = repo.obs?.overrides?.[platform]?.[env];
  const base = {
    platform,
    env,
    repo: repo.name,
    provider: binding?.provider ?? null,
    capability: binding?.capability ?? 'unknown',
    label: spec?.label ?? platform,
  };
  if (repo.obs?.covered === false) {
    return uncovered(base, [
      repo.obs.note ?? `${repo.name} is deliberately outside observability coverage`,
    ]);
  }
  if (spec === undefined || onEnv === undefined)
    return uncovered(base, [environments.envs[env]?.note ?? `${env} has no ${platform}`]);
  // `not_covered` on an entry is an answer, not a weak value: the pattern
  // would derive a coordinate that does not exist, so none is derived.
  if (override?.confidence === 'not_covered' || onEnv.confidence === 'not_covered') {
    return uncovered(base, [
      override?.note ?? onEnv.note ?? `${platform} has nothing for ${repo.name} in ${env}`,
    ]);
  }
  const vars = resolveVars(
    { ...spec.vars, ...onEnv.vars, ...override?.vars },
    { svc: serviceOf(repo), repo: repo.name, env },
  );
  const located = spec.command === undefined ? input.locate?.(vars) : undefined;
  const command = commandLine(spec.command, located, vars, input.commandShell);
  const missing = command === null ? [] : distinct(placeholders(command));
  const observation = onEnv.observations?.[repo.name];
  const observed =
    observation?.fingerprint === coordinateFingerprint({ provider: base.provider, vars })
      ? observation
      : undefined;
  return {
    ...base,
    status: 'located',
    label: located?.label === undefined ? base.label : substitute(located.label, vars).text,
    command: missing.length === 0 ? command : null,
    url: located?.url === undefined ? null : substitute(located.url, vars).text,
    confidence: observed?.confidence ?? weakest([onEnv.confidence, override?.confidence]),
    notes: distinct([
      observed?.note,
      observation && !observed
        ? 'Recorded probe evidence no longer matches these coordinate variables.'
        : undefined,
      missing.length === 0 ? undefined : `Missing coordinate variables: ${missing.join(', ')}`,
      override?.note,
      onEnv.note,
      repo.obs?.note,
      environments.envs[env]?.note,
      spec.note,
      templateShellNote(spec.command, input.commandShell),
    ]),
    vars,
  };
}

// The manifest's own template wins; it is a shell line and is printed as
// written. A provider default is a vector and gets quoted for pasting.
function commandLine(
  template: string | undefined,
  located: Coordinate | undefined,
  vars: Vars,
  shell?: ResolvedShell,
): string | null {
  if (template !== undefined) return substitute(template, vars).text;
  return located === undefined ? null : shellLine(located.command, shell);
}

function uncovered(
  base: Omit<ObsCoordinate, 'status' | 'command' | 'url' | 'confidence' | 'notes' | 'vars'>,
  notes: readonly string[],
): ObsCoordinate {
  return {
    ...base,
    status: 'not_covered',
    command: null,
    url: null,
    confidence: 'not_covered' as Confidence,
    notes: distinct(notes),
    vars: {},
  };
}

// Values may reference the built-ins: `slug: fx-{svc}-test`.
function resolveVars(raw: Vars, builtIn: Vars): Vars {
  // A blank override clears a default coordinate instead of producing a partial command.
  const all = Object.fromEntries(
    Object.entries({ ...builtIn, ...raw }).filter(([, value]) => value.trim() !== ''),
  );
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, substitute(v, all).text]));
}

function distinct(notes: readonly (string | undefined)[]): string[] {
  return [...new Set(notes.filter((n): n is string => n !== undefined && n !== ''))];
}

function templateShellNote(
  template: string | undefined,
  shell: ResolvedShell | undefined,
): string | undefined {
  return template !== undefined && shell && shell !== 'posix'
    ? 'The manifest command template is printed verbatim; its author owns shell compatibility.'
    : undefined;
}
