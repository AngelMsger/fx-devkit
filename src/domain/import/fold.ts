// From resolved repositories to a manifest a person would maintain: the
// common values become defaults, each entry keeps only what differs, and
// every project seen is seeded with an empty contact for lint to flag.

import { repoUrl } from '../workspace/ref.js';

import type { InferredRepo, ImportProvider } from './infer.js';

export interface FoldedDefaults {
  readonly host?: string;
  readonly upstream_project: string;
  readonly branch: string;
  readonly origin_pattern?: string;
}

export interface FoldedRepo {
  readonly name: string;
  readonly project?: string;
  readonly branch?: string;
  readonly path?: string;
  readonly upstream?: string;
  readonly review: readonly string[];
}

export interface FoldedManifest {
  readonly defaults: FoldedDefaults;
  readonly provider?: ImportProvider;
  readonly projects: readonly string[];
  readonly repos: readonly FoldedRepo[];
}

export function foldDefaults(repos: readonly InferredRepo[]): FoldedManifest {
  const first = repos[0]?.provider;
  const provider =
    first !== undefined &&
    repos.every(
      (repo) => repo.provider?.provider === first.provider && repo.provider.host === first.host,
    )
      ? first
      : undefined;
  const host = provider?.host;
  const project = mode(repos.map((r) => r.project)) ?? '';
  const branch = mode(repos.map((r) => r.branch)) ?? 'main';
  const defaults: FoldedDefaults = {
    ...(host === undefined ? {} : { host }),
    upstream_project: project,
    branch,
    ...(repos.some((r) => r.originPersonal) ? { origin_pattern: '~{user}/{repo}' } : {}),
  };
  return {
    defaults,
    ...(provider === undefined ? {} : { provider }),
    projects: [...new Set(repos.map((r) => r.project))].sort(),
    repos: [...repos]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({
        name: r.name,
        ...(r.project === project ? {} : { project: r.project }),
        ...(r.branch === branch ? {} : { branch: r.branch }),
        ...(r.rel === r.name ? {} : { path: r.rel }),
        ...(host !== undefined && r.upstream === repoUrl(host, r.project, r.name)
          ? {}
          : { upstream: r.upstream }),
        review: r.review,
      })),
  };
}

function mode(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  for (const [v, n] of counts) if (best === undefined || n > (counts.get(best) ?? 0)) best = v;
  return best;
}
