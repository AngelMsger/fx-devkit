// The personal layer applied to the shared registry. It is a filter plus an append,
// never a deep merge: a selection keeps or offers a shared entry, an override changes
// its path or branch, a local entry is added whole. Every other fact is re-read from the
// shared manifest on each load, so the personal file never goes stale.

import { DevkitError } from '../errors.js';
import { checkoutPathKey, checkoutPathsOverlap } from '../workspace/checkout.js';

import type { LocalLayer, Repo, Workspace } from './types.js';

export type Overridable = 'path' | 'branch';

export interface ResolvedRepo {
  readonly name: string;
  readonly path: string;
  readonly branch: string | undefined;
  readonly project: string | undefined;
  readonly upstream?: string;
  readonly desc?: string;
  readonly aka?: readonly string[];
  readonly links?: Readonly<Record<string, string>>;
  readonly tags: readonly string[];
  readonly obs?: Repo['obs'];
  readonly release?: Repo['release'];
  readonly origin: 'shared' | 'local' | 'manifest';
  readonly overridden: readonly Overridable[];
}

export interface ResolvedWorkspace {
  readonly repos: readonly ResolvedRepo[];
  readonly available: readonly string[];
  readonly envs: readonly string[] | undefined;
  readonly unmatched: readonly string[];
}

export function applyLocal(workspace: Workspace, local: LocalLayer): ResolvedWorkspace {
  const selection = local.scope?.repos;
  const known = new Set(workspace.repos.map((r) => r.name));
  const selected = selection === undefined ? known : new Set(selection);
  const overrides = local.overrides ?? {};

  const shared = workspace.repos
    .filter((repo) => selected.has(repo.name))
    .map((repo) => resolveSharedRepo({ workspace, local, repo }));
  const added = (local.repos ?? []).map((repo) => resolve(workspace, repo, 'local', {}));
  const available = workspace.repos.map((r) => r.name).filter((name) => !selected.has(name));
  const unmatched = [
    ...(selection ?? []).filter((name) => !known.has(name)).map((name) => `scope.repos.${name}`),
    ...Object.keys(overrides)
      .filter((name) => !known.has(name))
      .map((name) => `overrides.${name}`),
  ];
  const repos = [...shared, ...added];
  refuseCollisions(repos);
  return { repos, available, envs: local.scope?.envs, unmatched };
}

export function resolveSharedRepo(input: {
  readonly workspace: Workspace;
  readonly local: LocalLayer;
  readonly repo: Repo;
}): ResolvedRepo {
  return resolve(
    input.workspace,
    input.repo,
    'shared',
    input.local.overrides?.[input.repo.name] ?? {},
  );
}

function resolve(
  workspace: Workspace,
  repo: Repo,
  origin: ResolvedRepo['origin'],
  override: { readonly path?: string | undefined; readonly branch?: string | undefined },
): ResolvedRepo {
  const overridden: Overridable[] = [];
  if (override.path !== undefined) overridden.push('path');
  if (override.branch !== undefined) overridden.push('branch');
  return {
    name: repo.name,
    path: override.path ?? repo.path ?? repo.name,
    branch: override.branch ?? repo.branch ?? workspace.defaults.branch,
    project: repo.project ?? workspace.defaults.upstream_project,
    ...(repo.upstream === undefined ? {} : { upstream: repo.upstream }),
    ...(repo.desc === undefined ? {} : { desc: repo.desc }),
    ...(repo.aka === undefined ? {} : { aka: repo.aka }),
    ...(repo.links === undefined ? {} : { links: repo.links }),
    tags: repo.tags ?? [],
    ...(repo.obs === undefined ? {} : { obs: repo.obs }),
    ...(repo.release === undefined ? {} : { release: repo.release }),
    origin,
    overridden,
  };
}

// Two entries resolving to one name or one checkout would make sync and
// status operate on the wrong facts; the layer is refused, not repaired.
function refuseCollisions(repos: readonly ResolvedRepo[]): void {
  const names = new Set<string>();
  const paths = new Map<string, string>();
  const collisions: string[] = [];
  for (const repo of repos) {
    if (names.has(repo.name)) collisions.push(`name ${repo.name} appears twice`);
    names.add(repo.name);
    const key = checkoutPathKey(repo.path);
    const holder = [...paths].find(([other]) => checkoutPathsOverlap(key, other));
    if (holder !== undefined) {
      const relation =
        holder[0] === key ? `share the path ${repo.path}` : `overlap at ${repo.path}`;
      collisions.push(`${repo.name} and ${holder[1]} ${relation}`);
    }
    paths.set(key, repo.name);
  }
  if (collisions.length === 0) return;
  throw new DevkitError(
    'config',
    'LOCAL_INVALID',
    `the personal layer collides with the shared registry: ${collisions.join('; ')}`,
    {
      hint: 'local.yaml may only add repositories the manifest does not have, at paths nothing else uses.',
      nextSteps: ['fx repo list', 'fx self info'],
    },
  );
}
